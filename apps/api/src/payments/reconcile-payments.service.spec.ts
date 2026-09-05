import { ConfigService } from '@nestjs/config';
import { OrdersRepository } from '../checkout/orders.repository';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockRepository } from '../stock/stock.repository';
import { ConfirmOrderService } from './confirm-order.service';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';
import { PaymentsRepository } from './payments.repository';
import { ReconcilePaymentsService } from './reconcile-payments.service';

/**
 * T9.1 — contra Postgres real. `MercadoPagoClient.searchByExternalReference`
 * mockeado: lo que se prueba es que la reconciliación produce el MISMO
 * resultado que si el webhook hubiera llegado, no que MercadoPago funcione.
 */
describe('ReconcilePaymentsService.reconcile (US-010 T9.1)', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);
  const stock = new StockRepository(prisma);
  const payments = new PaymentsRepository(prisma);
  const config = new ConfigService({
    RECONCILE_MIN_AGE_MS: 300_000,
    RECONCILE_BATCH_SIZE: 50,
  }) as ConfigService;

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

  function servicio(mercadoPago: Partial<MercadoPagoClient>) {
    return new ReconcilePaymentsService(
      config,
      orders,
      mercadoPago as MercadoPagoClient,
      new ConfirmOrderService(prisma, orders, stock, payments, new PaymentsEventsService()),
      new PaymentsEventsService(),
    );
  }

  async function sembrarOrdenVieja(sku: string, stockInicial: number, qty: number, edadMs: number) {
    const producto = await prisma.product.create({
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
    const orden = await prisma.order.create({
      data: {
        access_token_hash: `h-${sku}`,
        buyer_name: 'Juana Pérez',
        buyer_email: 'juana@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: qty * 100_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: qty,
              unit_price_ars_cents: 100_000,
              product_name: sku,
              product_sku: sku,
            },
          ],
        },
      },
    });
    await prisma.order.update({
      where: { id: orden.id },
      data: { created_at: new Date(Date.now() - edadMs) },
    });
    return orden;
  }

  it('con searchByExternalReference devolviendo approved, confirma la orden y decrementa stock (idéntico al webhook)', async () => {
    const orden = await sembrarOrdenVieja('REC-A', 10, 2, 400_000); // 400s > 300s min age

    const servicioReconcile = servicio({
      searchByExternalReference: jest.fn().mockResolvedValue([
        { id: 'mp-rec-1', status: 'approved', amountArsCents: 200_000, externalReference: orden.id },
      ]),
    });

    const resultado = await servicioReconcile.reconcile();

    expect(resultado).toEqual({ scanned: 1, confirmed: 1, stillPending: 0 });
    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('new');
    const productoEnBase = await prisma.product.findFirstOrThrow({ where: { sku: 'REC-A' } });
    expect(productoEnBase.stock).toBe(8);
  });

  it('sin pago approved, la orden sigue pending_payment (stillPending)', async () => {
    await sembrarOrdenVieja('REC-B', 10, 1, 400_000);

    const servicioReconcile = servicio({
      searchByExternalReference: jest.fn().mockResolvedValue([
        { id: 'mp-rec-2', status: 'rejected', amountArsCents: 100_000 },
      ]),
    });

    const resultado = await servicioReconcile.reconcile();

    expect(resultado).toEqual({ scanned: 1, confirmed: 0, stillPending: 1 });
  });

  it('una orden más nueva que RECONCILE_MIN_AGE_MS no se escanea', async () => {
    await sembrarOrdenVieja('REC-C', 10, 1, 1_000); // 1s, muy por debajo de los 300s
    const searchSpy = jest.fn();
    const servicioReconcile = servicio({ searchByExternalReference: searchSpy });

    const resultado = await servicioReconcile.reconcile();

    expect(resultado.scanned).toBe(0);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('un pago ya confirmado por el webhook es un no-op (idempotencia)', async () => {
    const orden = await sembrarOrdenVieja('REC-D', 10, 1, 400_000);
    // Simula que el webhook YA confirmó esta orden antes de que corra la reconciliación.
    await prisma.order.update({ where: { id: orden.id }, data: { status: 'new' } });

    const searchSpy = jest.fn().mockResolvedValue([
      { id: 'mp-rec-4', status: 'approved', amountArsCents: 100_000 },
    ]);
    const servicioReconcile = servicio({ searchByExternalReference: searchSpy });

    const resultado = await servicioReconcile.reconcile();

    // La orden ya no está pending_payment, así que listByStatus('pending_payment')
    // no la trae: 0 escaneadas, cero llamada a MercadoPago para esta orden.
    expect(resultado.scanned).toBe(0);
    expect(searchSpy).not.toHaveBeenCalled();
  });
});
