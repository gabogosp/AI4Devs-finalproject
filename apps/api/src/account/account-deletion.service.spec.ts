import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from '../auth/customers.repository';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { PasswordResetTokensRepository } from '../auth/password-reset-tokens.repository';
import { CartsRepository } from '../cart/carts.repository';
import { OrdersRepository } from '../checkout/orders.repository';
import { AccountEventsService } from '../observability/account-events.service';
import { MetricsService } from '../observability/metrics.service';
import { AccountDeletionService } from './account-deletion.service';
import { AccountHasActiveOrdersError } from './account-errors';

/**
 * T3.1 — integración contra el Postgres real de docker-compose, mismo estilo
 * que `cancel-order.service.spec.ts`: los 3 casos obligatorios del plan
 * (éxito completo / bloqueo sin escritura / no-op idempotente).
 */
describe('AccountDeletionService.deleteAccount (US-020 T3.1)', () => {
  const prisma = new PrismaService();
  const customers = new CustomersRepository(prisma);
  const refreshTokens = new RefreshTokensRepository(prisma);
  const passwordResetTokens = new PasswordResetTokensRepository(prisma);
  const carts = new CartsRepository(prisma);
  const orders = new OrdersRepository(prisma);
  const HASH = '$2b$12$'.padEnd(60, 'x');
  const enUnaHora = () => new Date(Date.now() + 3_600_000);

  let productoId = '';
  let events: AccountEventsService;
  let service: AccountDeletionService;

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, carts, cart_items, refresh_tokens, password_reset_tokens, customers, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'ACC-DEL-A',
          slug: 'compresor-acc-del',
          name: 'Compresor',
          price_ars_cents: 850_000,
          stock: 10,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;

    events = new AccountEventsService(new MetricsService());
    service = new AccountDeletionService(
      prisma,
      customers,
      refreshTokens,
      passwordResetTokens,
      carts,
      orders,
      events,
    );
  });

  async function crearCliente(sufijo: string) {
    return customers.create({
      email: `cliente-${sufijo}@test.local`,
      name: `Cliente ${sufijo}`,
      passwordHash: HASH,
    });
  }

  async function crearOrdenDe(customerId: string, status: string) {
    const orden = await orders.createPendingOrder({
      accessTokenHash: `h-${Math.random()}`,
      buyerName: 'Comprador de Prueba',
      buyerEmail: 'comprador@test.local',
      buyerPhone: '+54 351 555 0000',
      consentAcceptedAt: new Date(),
      consentTermsVersion: '2026-06-15',
      totalArsCents: 850_000,
      lines: [
        {
          productId: productoId,
          quantity: 1,
          unitPriceArsCents: 850_000,
          productName: 'Compresor',
          productSku: 'ACC-DEL-A',
        },
      ],
    });
    await prisma.order.update({
      where: { id: orden.id },
      data: { customer_id: customerId, ...(status !== 'pending_payment' ? { status } : {}) },
    });
    return orden;
  }

  it('caso 1 — sin órdenes bloqueantes: anonimiza cuenta, revoca sesiones/resets, desvincula carritos, anonimiza órdenes y emite account.deleted una vez', async () => {
    const cliente = await crearCliente('happy');

    await refreshTokens.issue({
      customerId: cliente.id,
      tokenHash: 'rt-1',
      familyId: randomUUID(),
      expiresAt: enUnaHora(),
    });
    await passwordResetTokens.issue({
      customerId: cliente.id,
      tokenHash: 'prt-1',
      expiresAt: enUnaHora(),
    });
    const carrito = await carts.create({ tokenHash: 'cart-happy', expiresAt: enUnaHora() });
    await prisma.cart.update({ where: { id: carrito.id }, data: { customer_id: cliente.id } });

    const entregada = await crearOrdenDe(cliente.id, 'delivered');
    const cancelada = await crearOrdenDe(cliente.id, 'cancelled');

    await service.deleteAccount(cliente.id, 'trace-happy');

    const clienteReleido = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
    expect(clienteReleido.deleted_at).not.toBeNull();
    expect(clienteReleido.name).toBe('Cuenta eliminada');

    expect((await refreshTokens.findByHash('rt-1'))?.revoked_at).not.toBeNull();
    expect(await passwordResetTokens.findUsableByHash('prt-1')).toBeNull();

    const carritoReleido = await prisma.cart.findUniqueOrThrow({ where: { id: carrito.id } });
    expect(carritoReleido.customer_id).toBeNull();

    const [ordenEntregada, ordenCancelada] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: entregada.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: cancelada.id } }),
    ]);
    expect(ordenEntregada.anonymization_reason).toBe('account_deletion');
    expect(ordenCancelada.anonymization_reason).toBe('account_deletion');

    expect(await events.count('account.deleted')).toBe(1);
  });

  it('caso 2 — con una orden bloqueante: lanza AccountHasActiveOrdersError y NO escribe nada', async () => {
    const cliente = await crearCliente('blocked');
    await crearOrdenDe(cliente.id, 'new');

    await expect(service.deleteAccount(cliente.id, 'trace-blocked')).rejects.toThrow(
      AccountHasActiveOrdersError,
    );

    const clienteReleido = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
    expect(clienteReleido.deleted_at).toBeNull();
    expect(clienteReleido.name).toBe('Cliente blocked');

    expect(await events.count('account.deleted')).toBe(0);
  });

  it('caso 3 — sobre un cliente ya borrado: no lanza, no reanonimiza órdenes, no emite un segundo evento (AC-15)', async () => {
    const cliente = await crearCliente('doble');
    const orden = await crearOrdenDe(cliente.id, 'delivered');

    await service.deleteAccount(cliente.id, 'trace-1');
    const anonimizadaEn1 = (
      await prisma.order.findUniqueOrThrow({ where: { id: orden.id } })
    ).anonymized_at;

    await expect(service.deleteAccount(cliente.id, 'trace-2')).resolves.toBeUndefined();

    const anonimizadaEn2 = (
      await prisma.order.findUniqueOrThrow({ where: { id: orden.id } })
    ).anonymized_at;
    expect(anonimizadaEn2?.getTime()).toBe(anonimizadaEn1?.getTime());

    expect(await events.count('account.deleted')).toBe(1);
  });
});
