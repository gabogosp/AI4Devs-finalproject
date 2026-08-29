import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from './customers.repository';
import { PasswordResetTokensRepository } from './password-reset-tokens.repository';

describe('PasswordResetTokensRepository (integration)', () => {
  const prisma = new PrismaService();
  const repo = new PasswordResetTokensRepository(prisma);
  const customers = new CustomersRepository(prisma);

  const HASH = '$2b$12$'.padEnd(60, 'x');
  const enUnaHora = () => new Date(Date.now() + 3_600_000);
  const haceUnaHora = () => new Date(Date.now() - 3_600_000);

  let ana: string;
  let beto: string;

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
  });

  describe('findUsableByHash — los tres modos de fallo colapsan en null (AC-7)', () => {
    it('un token fresco se encuentra', async () => {
      await repo.issue({
        customerId: ana,
        tokenHash: 'fresco',
        expiresAt: enUnaHora(),
      });
      expect(await repo.findUsableByHash('fresco')).not.toBeNull();
    });

    it('el mismo token tras markUsed → null (un solo uso)', async () => {
      const t = await repo.issue({
        customerId: ana,
        tokenHash: 'usado',
        expiresAt: enUnaHora(),
      });
      await repo.markUsed(t.id);
      expect(await repo.findUsableByHash('usado')).toBeNull();
    });

    it('un token con expires_at en el pasado → null', async () => {
      await repo.issue({
        customerId: ana,
        tokenHash: 'vencido',
        expiresAt: haceUnaHora(),
      });
      expect(await repo.findUsableByHash('vencido')).toBeNull();
    });

    it('un token inexistente → null', async () => {
      expect(await repo.findUsableByHash('inventado')).toBeNull();
    });

    it('usado, vencido e inexistente son INDISTINGUIBLES desde afuera', async () => {
      // De este null sale un único InvalidResetTokenError. Si el repositorio
      // distinguiera los casos, el error también podría hacerlo, y eso le diría
      // a quien tenga el token si alguien más ya lo consumió.
      const t = await repo.issue({
        customerId: ana,
        tokenHash: 'u',
        expiresAt: enUnaHora(),
      });
      await repo.markUsed(t.id);
      await repo.issue({
        customerId: ana,
        tokenHash: 'v',
        expiresAt: haceUnaHora(),
      });

      const resultados = await Promise.all([
        repo.findUsableByHash('u'),
        repo.findUsableByHash('v'),
        repo.findUsableByHash('x'),
      ]);
      expect(resultados).toEqual([null, null, null]);
    });
  });

  describe('countIssuedSince', () => {
    it('cuenta sólo los de la última hora y sólo del cliente correcto', async () => {
      await repo.issue({
        customerId: ana,
        tokenHash: 'a1',
        expiresAt: enUnaHora(),
      });
      await repo.issue({
        customerId: ana,
        tokenHash: 'a2',
        expiresAt: enUnaHora(),
      });
      await repo.issue({
        customerId: beto,
        tokenHash: 'b1',
        expiresAt: enUnaHora(),
      });

      const haceUnaHoraExacta = new Date(Date.now() - 3_600_000);
      expect(await repo.countIssuedSince(ana, haceUnaHoraExacta)).toBe(2);
      expect(await repo.countIssuedSince(beto, haceUnaHoraExacta)).toBe(1);
    });

    it('no cuenta los emitidos antes de la ventana', async () => {
      const t = await repo.issue({
        customerId: ana,
        tokenHash: 'viejo',
        expiresAt: enUnaHora(),
      });
      await prisma.passwordResetToken.update({
        where: { id: t.id },
        data: { created_at: new Date(Date.now() - 7_200_000) },
      });
      expect(
        await repo.countIssuedSince(ana, new Date(Date.now() - 3_600_000)),
      ).toBe(0);
    });

    it('cuenta también los ya usados — el límite es de EMISIÓN, no de pendientes', async () => {
      // Si sólo contara los pendientes, completar un reset liberaría cupo y el
      // límite por hora dejaría de acotar los emails enviados.
      const t = await repo.issue({
        customerId: ana,
        tokenHash: 'consumido',
        expiresAt: enUnaHora(),
      });
      await repo.markUsed(t.id);
      expect(
        await repo.countIssuedSince(ana, new Date(Date.now() - 3_600_000)),
      ).toBe(1);
    });
  });

  describe('deleteAllForCustomer', () => {
    it('borra todos los del cliente y ninguno de otro', async () => {
      await repo.issue({
        customerId: ana,
        tokenHash: 'a1',
        expiresAt: enUnaHora(),
      });
      await repo.issue({
        customerId: ana,
        tokenHash: 'a2',
        expiresAt: enUnaHora(),
      });
      await repo.issue({
        customerId: beto,
        tokenHash: 'b1',
        expiresAt: enUnaHora(),
      });

      expect(await repo.deleteAllForCustomer(ana)).toBe(2);
      // Un enlace viejo que sobreviviera al cambio de contraseña es el camino
      // por el que un atacante que pidió un reset antes recupera el acceso.
      expect(await repo.findUsableByHash('a1')).toBeNull();
      expect(await repo.findUsableByHash('b1')).not.toBeNull();
    });
  });

  it('borrar el cliente se lleva sus tokens de reset (FK en cascada, T0.2)', async () => {
    await repo.issue({
      customerId: ana,
      tokenHash: 'cascada',
      expiresAt: enUnaHora(),
    });
    await prisma.customer.delete({ where: { id: ana } });
    expect(await repo.findUsableByHash('cascada')).toBeNull();
  });
});
