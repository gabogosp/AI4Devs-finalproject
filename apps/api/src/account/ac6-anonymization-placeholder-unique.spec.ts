import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from '../auth/customers.repository';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { PasswordResetTokensRepository } from '../auth/password-reset-tokens.repository';
import { CartsRepository } from '../cart/carts.repository';
import { OrdersRepository } from '../checkout/orders.repository';
import { AccountEventsService } from '../observability/account-events.service';
import { AccountDeletionService } from './account-deletion.service';

/**
 * T5.6 — AC-6: el placeholder de email es función del `customerId` (T1.1),
 * así que 2 borrados nunca chocan contra el `UNIQUE` de `customers.email` —
 * ni en secuencia ni en paralelo real (`Promise.all`).
 */
describe('AC-6 — placeholder de email único, sin colisión concurrente (ac6-anonymization-placeholder-unique)', () => {
  const prisma = new PrismaService();
  const customers = new CustomersRepository(prisma);
  const HASH = '$2b$12$'.padEnd(60, 'x');
  let service: AccountDeletionService;

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
    service = new AccountDeletionService(
      prisma,
      customers,
      new RefreshTokensRepository(prisma),
      new PasswordResetTokensRepository(prisma),
      new CartsRepository(prisma),
      new OrdersRepository(prisma),
      new AccountEventsService(),
    );
  });

  it('2 clientes borrando en SECUENCIA: sin error de UNIQUE, placeholders distintos', async () => {
    const a = await customers.create({ email: 'sec-a@test.local', name: 'A', passwordHash: HASH });
    const b = await customers.create({ email: 'sec-b@test.local', name: 'B', passwordHash: HASH });

    await service.deleteAccount(a.id);
    await service.deleteAccount(b.id);

    const [releidoA, releidoB] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: a.id } }),
      prisma.customer.findUniqueOrThrow({ where: { id: b.id } }),
    ]);
    expect(releidoA.email).not.toBe(releidoB.email);
  });

  it('2 clientes borrando EN PARALELO (Promise.all): sin error de UNIQUE, placeholders distintos', async () => {
    const a = await customers.create({ email: 'par-a@test.local', name: 'A', passwordHash: HASH });
    const b = await customers.create({ email: 'par-b@test.local', name: 'B', passwordHash: HASH });

    await expect(
      Promise.all([service.deleteAccount(a.id), service.deleteAccount(b.id)]),
    ).resolves.toBeDefined();

    const [releidoA, releidoB] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: a.id } }),
      prisma.customer.findUniqueOrThrow({ where: { id: b.id } }),
    ]);
    expect(releidoA.email).not.toBe(releidoB.email);
    expect(releidoA.deleted_at).not.toBeNull();
    expect(releidoB.deleted_at).not.toBeNull();
  });
});
