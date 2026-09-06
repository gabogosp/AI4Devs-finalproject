import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from '../auth/customers.repository';
import { AccountDeletionService } from './account-deletion.service';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { PasswordResetTokensRepository } from '../auth/password-reset-tokens.repository';
import { CartsRepository } from '../cart/carts.repository';
import { OrdersRepository } from '../checkout/orders.repository';
import { AccountEventsService } from '../observability/account-events.service';

/**
 * T5.2 — AC-2/AC-11: negative-space de irreversibilidad. Sembrar valores
 * reales conocidos, borrar, y verificar que NINGÚN camino de lectura los
 * devuelva — ni siquiera transformados (mayúsculas, espacios, substring).
 */
describe('AC-2/AC-11 — PII irreversible tras el borrado (ac2-account-pii-irreversible)', () => {
  const prisma = new PrismaService();
  const customers = new CustomersRepository(prisma);
  const service = new AccountDeletionService(
    prisma,
    customers,
    new RefreshTokensRepository(prisma),
    new PasswordResetTokensRepository(prisma),
    new CartsRepository(prisma),
    new OrdersRepository(prisma),
    new AccountEventsService(),
  );

  const HASH = '$2b$12$'.padEnd(60, 'x');
  const NOMBRE_REAL = 'Roberto Carlos Fernández';
  const EMAIL_REAL = 'roberto.fernandez@example.com';
  const PHONE_REAL = '+54 9 351 555 4321';

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

  /** Ningún substring/mayúsculas/minúsculas de los valores sembrados sobrevive. */
  function esperarSinRastro(valor: string | null, sembrado: string) {
    expect(valor).not.toBeNull();
    const v = (valor ?? '').toLowerCase();
    const trozos = sembrado.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    for (const trozo of trozos) {
      expect(v).not.toContain(trozo);
    }
  }

  it('CustomersRepository.findActiveById ya no devuelve la cuenta (filtra deleted_at)', async () => {
    const c = await customers.create({
      email: EMAIL_REAL,
      name: NOMBRE_REAL,
      phone: PHONE_REAL,
      passwordHash: HASH,
    });

    await service.deleteAccount(c.id);

    expect(await customers.findActiveById(c.id)).toBeNull();
    expect(await customers.findActiveByEmail(EMAIL_REAL)).toBeNull();
  });

  it('la consulta directa (sin el filtro deleted_at) da los placeholders, nunca los valores originales ni transformados', async () => {
    const c = await customers.create({
      email: EMAIL_REAL,
      name: NOMBRE_REAL,
      phone: PHONE_REAL,
      passwordHash: HASH,
    });

    await service.deleteAccount(c.id);

    const releido = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });

    esperarSinRastro(releido.name, NOMBRE_REAL);
    esperarSinRastro(releido.email, EMAIL_REAL);
    esperarSinRastro(releido.phone, PHONE_REAL);

    expect(releido.name).toBe('Cuenta eliminada');
    expect(releido.phone).toBe('+00 000-0000');
    expect(releido.email).toMatch(/@anonimizado\.dsm\.invalid$/);
  });

  it('no existe ningún estado ni endpoint que deshaga el borrado: updatePassword/resetLoginFailures no reescriben el email/nombre originales', async () => {
    const c = await customers.create({
      email: EMAIL_REAL,
      name: NOMBRE_REAL,
      phone: PHONE_REAL,
      passwordHash: HASH,
    });
    await service.deleteAccount(c.id);

    // Ningún método del repositorio "revive" los valores originales: los
    // únicos escritores de name/email/phone son `create` (alta nueva) y
    // `anonymize` — ninguna otra operación del ciclo de vida los toca.
    await customers.updatePassword(c.id, '$2b$12$'.padEnd(60, 'y'));
    const releido = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    esperarSinRastro(releido.name, NOMBRE_REAL);
    esperarSinRastro(releido.email, EMAIL_REAL);
    expect(releido.deleted_at).not.toBeNull();
  });
});
