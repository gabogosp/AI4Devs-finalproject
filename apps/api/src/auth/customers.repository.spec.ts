import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from './customers.repository';
import { RegistrationFailedError } from '../common/errors/auth-errors';

/**
 * T2.1 (+ cierre del Verify de T1.3) — integration contra el Postgres real.
 *
 * La normalización de email se verifica **acá y no sólo en el unit**: el unit
 * prueba que la función colapsa las variantes, esto prueba que la base lo
 * respeta. Son cosas distintas — una función correcta que el repositorio olvide
 * llamar deja pasar duplicados igual.
 */
describe('CustomersRepository (integration)', () => {
  const prisma = new PrismaService();
  const repo = new CustomersRepository(prisma);

  const HASH = '$2b$12$'.padEnd(60, 'x');

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
    );
  });

  describe('create', () => {
    it('da de alta y NO devuelve el hash en el objeto (AC-8)', async () => {
      const c = await repo.create({
        email: 'ana@example.com',
        name: 'Ana',
        passwordHash: HASH,
      });
      expect(c.id).toBeTruthy();
      expect(c.email).toBe('ana@example.com');
      expect(c).not.toHaveProperty('password_hash');
      expect(JSON.stringify(c)).not.toContain(HASH);
    });

    it('el alta duplicada da RegistrationFailedError, NO un error crudo de Prisma (§6)', async () => {
      await repo.create({
        email: 'ana@example.com',
        name: 'Ana',
        passwordHash: HASH,
      });
      const error = await repo
        .create({ email: 'ana@example.com', name: 'Otra', passwordHash: HASH })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RegistrationFailedError);
      // El mensaje no confirma que el email ya está registrado (AC-6).
      expect((error as Error).message).not.toMatch(/ya (existe|está)/i);
      expect((error as Error).message).not.toContain('ana@example.com');
    });

    it('normaliza al escribir: la variante con espacios y mayúsculas colisiona con el UNIQUE (T1.3)', async () => {
      await repo.create({
        email: 'ana.perez@example.com',
        name: 'Ana',
        passwordHash: HASH,
      });
      await expect(
        repo.create({
          email: '  Ana.Perez@Example.COM ',
          name: 'Impostora',
          passwordHash: HASH,
        }),
      ).rejects.toBeInstanceOf(RegistrationFailedError);
    });

    it('phone es opcional y queda null', async () => {
      const c = await repo.create({
        email: 'sin-telefono@example.com',
        name: 'Sin Teléfono',
        passwordHash: HASH,
      });
      expect(c.phone).toBeNull();
    });
  });

  describe('findActiveByEmail', () => {
    beforeEach(async () => {
      await repo.create({
        email: '  Ana.Perez@Example.COM ',
        name: 'Ana',
        passwordHash: HASH,
      });
    });

    it('encuentra por la forma normalizada aunque se haya insertado con otra (T1.3)', async () => {
      const c = await repo.findActiveByEmail('ana.perez@example.com');
      expect(c?.name).toBe('Ana');
    });

    it('la búsqueda también normaliza: cualquier variante de tipeo encuentra la fila', async () => {
      for (const variante of [
        'ANA.PEREZ@EXAMPLE.COM',
        ' ana.perez@example.com ',
        'Ana.Perez@Example.Com',
      ]) {
        expect(await repo.findActiveByEmail(variante)).not.toBeNull();
      }
    });

    it('null si no existe', async () => {
      expect(await repo.findActiveByEmail('nadie@example.com')).toBeNull();
    });

    it('un cliente con deleted_at NO se devuelve, aunque el email coincida', async () => {
      await prisma.customer.updateMany({
        where: { email: 'ana.perez@example.com' },
        data: { deleted_at: new Date() },
      });
      expect(await repo.findActiveByEmail('ana.perez@example.com')).toBeNull();
    });

    it('findActiveByEmail no expone el hash; findActiveByEmailWithHash sí (y sólo ese)', async () => {
      expect(await repo.findActiveByEmail('ana.perez@example.com')).not.toHaveProperty(
        'password_hash',
      );
      const conHash = await repo.findActiveByEmailWithHash(
        'ana.perez@example.com',
      );
      expect(conHash?.password_hash).toBe(HASH);
    });
  });

  describe('findActiveById', () => {
    it('devuelve el cliente activo y filtra el borrado', async () => {
      const c = await repo.create({
        email: 'id@example.com',
        name: 'Por Id',
        passwordHash: HASH,
      });
      expect(await repo.findActiveById(c.id)).not.toBeNull();

      await prisma.customer.update({
        where: { id: c.id },
        data: { deleted_at: new Date() },
      });
      expect(await repo.findActiveById(c.id)).toBeNull();
    });
  });

  describe('contadores de login', () => {
    it('registerFailedLogin incrementa de forma atómica y devuelve el total', async () => {
      const c = await repo.create({
        email: 'fallos@example.com',
        name: 'Fallos',
        passwordHash: HASH,
      });
      expect(await repo.registerFailedLogin(c.id)).toBe(1);
      expect(await repo.registerFailedLogin(c.id)).toBe(2);
    });

    it('cinco intentos concurrentes cuentan cinco — ninguno se pierde', async () => {
      // Un leer-sumar-escribir perdería intentos bajo concurrencia, y ése es
      // exactamente el camino que un atacante paralelizaría para no gastar el
      // presupuesto de bloqueo.
      const c = await repo.create({
        email: 'carrera@example.com',
        name: 'Carrera',
        passwordHash: HASH,
      });
      await Promise.all(
        Array.from({ length: 5 }, () => repo.registerFailedLogin(c.id)),
      );
      const fresco = await prisma.customer.findUnique({ where: { id: c.id } });
      expect(fresco?.failed_login_attempts).toBe(5);
    });

    it('resetLoginFailures limpia contador y bloqueo, sella last_login_at, y CONSERVA lockout_count', async () => {
      const c = await repo.create({
        email: 'reset@example.com',
        name: 'Reset',
        passwordHash: HASH,
      });
      await repo.lockUntil(c.id, new Date(Date.now() + 60_000), 3);
      await repo.resetLoginFailures(c.id);

      const fresco = await prisma.customer.findUnique({ where: { id: c.id } });
      expect(fresco?.failed_login_attempts).toBe(0);
      expect(fresco?.locked_until).toBeNull();
      expect(fresco?.last_login_at).toBeInstanceOf(Date);
      // La memoria del backoff sobrevive al login exitoso: si se reseteara,
      // alternar fallos con un login válido mantendría el castigo en el mínimo.
      expect(fresco?.lockout_count).toBe(3);
    });

    it('lockUntil fija el vencimiento y pone el contador de intentos en cero', async () => {
      const c = await repo.create({
        email: 'lock@example.com',
        name: 'Lock',
        passwordHash: HASH,
      });
      await repo.registerFailedLogin(c.id);
      const hasta = new Date(Date.now() + 900_000);
      await repo.lockUntil(c.id, hasta, 1);

      const fresco = await prisma.customer.findUnique({ where: { id: c.id } });
      expect(fresco?.locked_until?.getTime()).toBe(hasta.getTime());
      expect(fresco?.lockout_count).toBe(1);
      expect(fresco?.failed_login_attempts).toBe(0);
    });
  });

  describe('updatePassword', () => {
    it('cambia el hash, sella password_changed_at y levanta el bloqueo', async () => {
      const c = await repo.create({
        email: 'cambio@example.com',
        name: 'Cambio',
        passwordHash: HASH,
      });
      await repo.lockUntil(c.id, new Date(Date.now() + 60_000), 1);

      const nuevo = '$2b$12$'.padEnd(60, 'y');
      await repo.updatePassword(c.id, nuevo);

      const fresco = await prisma.customer.findUnique({ where: { id: c.id } });
      expect(fresco?.password_hash).toBe(nuevo);
      expect(fresco?.password_changed_at).toBeInstanceOf(Date);
      // Quien recuperó su contraseña debe poder entrar en el acto: dejarlo
      // bloqueado convertiría el reset en un camino sin salida.
      expect(fresco?.locked_until).toBeNull();
      expect(fresco?.failed_login_attempts).toBe(0);
    });
  });
});
