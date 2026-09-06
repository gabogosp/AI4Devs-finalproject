import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from '../auth/customers.repository';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { PasswordResetTokensRepository } from '../auth/password-reset-tokens.repository';
import { CartsRepository } from '../cart/carts.repository';
import { OrdersRepository, BLOCKING_ORDER_STATUSES } from '../checkout/orders.repository';
import { AccountEventsService } from '../observability/account-events.service';
import { AccountDeletionService } from './account-deletion.service';
import { AccountHasActiveOrdersError } from './account-errors';

/**
 * T5.4 — AC-4/AC-9: bloqueo por órdenes en curso, y las DOS direcciones de la
 * carrera (`threat-modeling-lite` superficie 3): una orden creada/transicionada
 * a bloqueante JUSTO ANTES de la transacción bloquea igual; una bloqueante que
 * pasa a `delivered` ANTES de que el `DELETE` llegue al servidor NO bloquea.
 */
describe('AC-4/AC-9 — bloqueo por órdenes en curso + carrera (ac4-ac9-blocking-orders-race)', () => {
  const prisma = new PrismaService();
  const customers = new CustomersRepository(prisma);
  const orders = new OrdersRepository(prisma);
  const HASH = '$2b$12$'.padEnd(60, 'x');
  let service: AccountDeletionService;
  let productoId = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, customers, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-ac4-ac9' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'AC4-A',
          slug: 'compresor-ac4',
          name: 'Compresor',
          price_ars_cents: 850_000,
          stock: 10,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    service = new AccountDeletionService(
      prisma,
      customers,
      new RefreshTokensRepository(prisma),
      new PasswordResetTokensRepository(prisma),
      new CartsRepository(prisma),
      orders,
      new AccountEventsService(),
    );
  });

  async function crearCliente(sufijo: string) {
    return customers.create({
      email: `ac4ac9-${sufijo}@test.local`,
      name: `Cliente ${sufijo}`,
      passwordHash: HASH,
    });
  }

  async function crearOrden(customerId: string, sufijo: string, status: string) {
    return prisma.order.create({
      data: {
        access_token_hash: `h-ac4ac9-${sufijo}`,
        customer_id: customerId,
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 850_000,
        status,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: productoId,
              quantity: 1,
              unit_price_ars_cents: 850_000,
              product_name: 'Compresor',
              product_sku: 'AC4-A',
            },
          ],
        },
      },
    });
  }

  it.each(BLOCKING_ORDER_STATUSES)(
    'con una orden en estado %s: 409 con esa orden listada, customers.deleted_at sigue null',
    async (status) => {
      const cliente = await crearCliente(`blk-${status}`);
      const orden = await crearOrden(cliente.id, `blk-${status}`, status);

      let capturado: unknown;
      try {
        await service.deleteAccount(cliente.id);
      } catch (error) {
        capturado = error;
      }

      expect(capturado).toBeInstanceOf(AccountHasActiveOrdersError);
      const err = capturado as AccountHasActiveOrdersError;
      expect(err.extensions?.blocking_orders).toEqual([
        expect.objectContaining({ order_number: orden.order_number, status }),
      ]);

      const releido = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(releido.deleted_at).toBeNull();
    },
  );

  it.each(['delivered', 'cancelled'])(
    'con una orden en estado %s: NO bloquea el borrado',
    async (status) => {
      const cliente = await crearCliente(`noblk-${status}`);
      await crearOrden(cliente.id, `noblk-${status}`, status);

      await expect(service.deleteAccount(cliente.id)).resolves.toBeUndefined();

      const releido = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(releido.deleted_at).not.toBeNull();
    },
  );

  it('carrera dirección 1 — una orden transicionada a bloqueante JUSTO ANTES de la transacción bloquea igual', async () => {
    const cliente = await crearCliente('race-1');
    const orden = await crearOrden(cliente.id, 'race-1', 'new');
    // Simula que la orden pasó a bloqueante DESPUÉS de que el cliente vio la
    // pantalla de confirmación (p. ej. otra pestaña acaba de comprar).
    await prisma.order.update({ where: { id: orden.id }, data: { status: 'preparing' } });

    await expect(service.deleteAccount(cliente.id)).rejects.toThrow(
      AccountHasActiveOrdersError,
    );
    const releido = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
    expect(releido.deleted_at).toBeNull();
  });

  it('carrera dirección 2 — una orden bloqueante que pasa a delivered ANTES de que el DELETE llegue al servidor NO bloquea', async () => {
    const cliente = await crearCliente('race-2');
    const orden = await crearOrden(cliente.id, 'race-2', 'ready');
    // El dueño marca la entrega justo antes de que el DELETE llegue: la
    // verificación es al EJECUTAR, no al mostrar la pantalla (AC-9).
    await prisma.order.update({ where: { id: orden.id }, data: { status: 'delivered' } });

    await expect(service.deleteAccount(cliente.id)).resolves.toBeUndefined();
    const releido = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
    expect(releido.deleted_at).not.toBeNull();
  });
});
