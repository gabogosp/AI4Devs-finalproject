import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from './customers.repository';
import { RefreshTokensRepository } from './refresh-tokens.repository';

describe('RefreshTokensRepository (integration)', () => {
  const prisma = new PrismaService();
  const repo = new RefreshTokensRepository(prisma);
  const customers = new CustomersRepository(prisma);

  const HASH = '$2b$12$'.padEnd(60, 'x');
  const enUnaHora = () => new Date(Date.now() + 3_600_000);
  const haceUnaHora = () => new Date(Date.now() - 3_600_000);

  let ana: string;
  let beto: string;
  // `family_id` es UUID en el esquema: la familia se identifica con el mismo
  // tipo que las claves, no con una etiqueta libre.
  let famA: string;
  let famB: string;

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
    ana = (
      await customers.create({
        email: 'ana@example.com',
        name: 'Ana',
        passwordHash: HASH,
      })
    ).id;
    beto = (
      await customers.create({
        email: 'beto@example.com',
        name: 'Beto',
        passwordHash: HASH,
      })
    ).id;
    famA = randomUUID();
    famB = randomUUID();
  });

  describe('findByHash', () => {
    it('devuelve el token ROTADO en vez de null — sin eso no hay detección de reuso', async () => {
      // Ésta es la decisión de diseño que sostiene ADR-0011: si el repositorio
      // filtrara los rotados, una réplica sería indistinguible de un token
      // inventado y la familia nunca se revocaría.
      const t = await repo.issue({
        customerId: ana,
        tokenHash: 'hash-rotado',
        familyId: famA,
        expiresAt: enUnaHora(),
      });
      await repo.markRotated(t.id);

      const encontrado = await repo.findByHash('hash-rotado');
      expect(encontrado).not.toBeNull();
      expect(encontrado?.rotated_at).toBeInstanceOf(Date);
    });

    it('null si el hash no existe', async () => {
      expect(await repo.findByHash('no-existe')).toBeNull();
    });
  });

  describe('revokeFamily', () => {
    it('revoca las 3 de la familia y deja intacta la de otra familia', async () => {
      for (const h of ['a1', 'a2', 'a3']) {
        await repo.issue({
          customerId: ana,
          tokenHash: h,
          familyId: famA,
          expiresAt: enUnaHora(),
        });
      }
      await repo.issue({
        customerId: ana,
        tokenHash: 'b1',
        familyId: famB,
        expiresAt: enUnaHora(),
      });

      expect(await repo.revokeFamily(famA)).toBe(3);

      const revocados = await prisma.refreshToken.findMany({
        where: { revoked_at: { not: null } },
      });
      expect(revocados.map((t) => t.token_hash).sort()).toEqual([
        'a1',
        'a2',
        'a3',
      ]);
      // La otra sesión del mismo cliente sigue viva: el reuso mata la familia
      // comprometida, no todas las sesiones de la persona.
      expect((await repo.findByHash('b1'))?.revoked_at).toBeNull();
    });

    it('revocar una familia ya revocada no cuenta de nuevo (idempotente)', async () => {
      await repo.issue({
        customerId: ana,
        tokenHash: 'c1',
        familyId: famA,
        expiresAt: enUnaHora(),
      });
      expect(await repo.revokeFamily(famA)).toBe(1);
      expect(await repo.revokeFamily(famA)).toBe(0);
    });
  });

  describe('revokeAllForCustomer', () => {
    it('revoca todas las familias del cliente y ninguna de otro', async () => {
      await repo.issue({
        customerId: ana,
        tokenHash: 'ana-1',
        familyId: famA,
        expiresAt: enUnaHora(),
      });
      await repo.issue({
        customerId: ana,
        tokenHash: 'ana-2',
        familyId: famB,
        expiresAt: enUnaHora(),
      });
      await repo.issue({
        customerId: beto,
        tokenHash: 'beto-1',
        familyId: randomUUID(),
        expiresAt: enUnaHora(),
      });

      expect(await repo.revokeAllForCustomer(ana)).toBe(2);
      expect((await repo.findByHash('beto-1'))?.revoked_at).toBeNull();
    });
  });

  describe('purgeExpiredForCustomer', () => {
    it('borra sólo el vencido de ESE cliente: no toca el vigente ni el de otro', async () => {
      await repo.issue({
        customerId: ana,
        tokenHash: 'ana-vencido',
        familyId: famA,
        expiresAt: haceUnaHora(),
      });
      await repo.issue({
        customerId: ana,
        tokenHash: 'ana-vigente',
        familyId: famA,
        expiresAt: enUnaHora(),
      });
      await repo.issue({
        customerId: beto,
        tokenHash: 'beto-vencido',
        familyId: famB,
        expiresAt: haceUnaHora(),
      });

      expect(await repo.purgeExpiredForCustomer(ana)).toBe(1);
      expect(await repo.findByHash('ana-vencido')).toBeNull();
      expect(await repo.findByHash('ana-vigente')).not.toBeNull();
      // Un barrido global en el camino del login sería un scan de tabla en la
      // ruta más caliente del sistema; el alcance por cliente es deliberado.
      expect(await repo.findByHash('beto-vencido')).not.toBeNull();
    });
  });

  it('borrar el cliente se lleva sus refresh tokens (FK en cascada, T0.2)', async () => {
    await repo.issue({
      customerId: ana,
      tokenHash: 'cascada',
      familyId: famA,
      expiresAt: enUnaHora(),
    });
    await prisma.customer.delete({ where: { id: ana } });
    expect(await repo.findByHash('cascada')).toBeNull();
  });
});
