import { OrdersRepository } from '../checkout/orders.repository';
import { PrismaService } from '../prisma/prisma.service';
import { StockRepository } from '../stock/stock.repository';
import { InsufficientStockError } from '../stock/stock-errors';
import { ConfirmOrderService } from './confirm-order.service';
import { OrderNotFoundError, OrderNotPendingPaymentError } from './payment-confirmation-errors';
import { PaymentsRepository } from './payments.repository';

/**
 * T3.3 — integración de punta a punta contra Postgres real: las tres
 * propiedades que `design.md` §Approach exige y que un mock no podría
 * demostrar — la orden llega a `new` DE VERDAD, el stock decrementa DE
 * VERDAD, y un fallo a mitad de camino revierte TODO (F50).
 */
describe('ConfirmOrderService.confirm (US-023)', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);
  const stock = new StockRepository(prisma);
  const payments = new PaymentsRepository(prisma);
  const service = new ConfirmOrderService(prisma, orders, stock, payments);

  let categoriaId = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE payments, orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
    categoriaId = (
      await prisma.category.create({ data: { name: 'Refrigeración', slug: 'refrigeracion' } })
    ).id;
  });

  async function crearProducto(sku: string, stockInicial: number) {
    return prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: sku,
        price_ars_cents: 100_000,
        stock: stockInicial,
        status: 'published',
        category_id: categoriaId,
      },
    });
  }

  async function crearOrdenPendiente(lineas: { productId: string; quantity: number }[]) {
    return prisma.order.create({
      data: {
        access_token_hash: `h-${Math.random()}`,
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: lineas.length * 100_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: lineas.map((l) => ({
            product_id: l.productId,
            quantity: l.quantity,
            unit_price_ars_cents: 100_000,
            product_name: 'x',
            product_sku: 'x',
          })),
        },
      },
      include: { items: true },
    });
  }

  it('happy path: orden pending_payment con stock suficiente pasa a new, stock decrementado, payments con provider=manual (AC-1, AC-6)', async () => {
    const producto = await crearProducto('CONF-A', 10);
    const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 3 }]);

    const resultado = await service.confirm({
      orderId: orden.id,
      provider: 'manual',
      confirmedBy: 'admin',
    });

    expect(resultado.status).toBe('new');
    expect(resultado.orderNumber).toBe(orden.order_number);

    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('new');

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(7);

    const pago = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
    expect(pago.provider).toBe('manual');
    expect(pago.confirmed_by).toBe('admin');
  });

  it('orden que no existe: 404 (OrderNotFoundError)', async () => {
    await expect(
      service.confirm({
        orderId: '00000000-0000-0000-0000-000000000000',
        provider: 'manual',
        confirmedBy: 'admin',
      }),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it('orden que ya no está pending_payment: rechaza sin tocar stock ni crear payments (AC-4)', async () => {
    const producto = await crearProducto('CONF-B', 10);
    const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 2 }]);
    await orders.transitionToNewIfPending(orden.id); // la deja en `new` de entrada

    await expect(
      service.confirm({ orderId: orden.id, provider: 'manual', confirmedBy: 'admin' }),
    ).rejects.toBeInstanceOf(OrderNotPendingPaymentError);

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(10); // sin tocar
    expect(await prisma.payment.count({ where: { order_id: orden.id } })).toBe(0);
  });

  it('doble confirmación (AC-5): la segunda llamada rechaza, la orden permanece en new sin efectos duplicados', async () => {
    const producto = await crearProducto('CONF-C', 10);
    const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 2 }]);

    await service.confirm({ orderId: orden.id, provider: 'manual', confirmedBy: 'admin' });

    await expect(
      service.confirm({ orderId: orden.id, provider: 'manual', confirmedBy: 'admin' }),
    ).rejects.toBeInstanceOf(OrderNotPendingPaymentError);

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(8); // decrementado UNA sola vez
    expect(await prisma.payment.count({ where: { order_id: orden.id } })).toBe(1);
  });

  it('stock insuficiente al confirmar: la orden permanece pending_payment, stock sin tocar, sin fila en payments', async () => {
    const producto = await crearProducto('CONF-D', 1);
    const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 5 }]);

    await expect(
      service.confirm({ orderId: orden.id, provider: 'manual', confirmedBy: 'admin' }),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('pending_payment');

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(1);

    expect(await prisma.payment.count({ where: { order_id: orden.id } })).toBe(0);
  });

  it('múltiples líneas, una sin stock: NINGUNA línea queda decrementada (rollback completo)', async () => {
    const p1 = await crearProducto('CONF-E1', 10);
    const p2 = await crearProducto('CONF-E2', 1);
    const orden = await crearOrdenPendiente([
      { productId: p1.id, quantity: 4 },
      { productId: p2.id, quantity: 5 },
    ]);

    await expect(
      service.confirm({ orderId: orden.id, provider: 'manual', confirmedBy: 'admin' }),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    const p1EnBase = await prisma.product.findUniqueOrThrow({ where: { id: p1.id } });
    const p2EnBase = await prisma.product.findUniqueOrThrow({ where: { id: p2.id } });
    expect(p1EnBase.stock).toBe(10); // se había decrementado y revirtió
    expect(p2EnBase.stock).toBe(1);
  });
});
