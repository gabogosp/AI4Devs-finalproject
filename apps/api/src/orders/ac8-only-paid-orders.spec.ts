import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersModule } from './orders.module';

/**
 * T8.4 — AC-8: "solo pagadas" probado con las 6 filas del enum de `status`
 * sembradas directo con `prisma.order.create` — sin depender de que exista
 * ningún flujo real de pago/checkout para llegar a cada estado
 * (`proposal.md` "Dependencias").
 */
describe('AC-8 — sólo pagadas, con los 6 estados sembrados (e2e-orders)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productId: string;

  beforeAll(async () => {
    app = await bootTestApp([OrdersModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, order_status_history, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-ac8' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'AC8-A',
          slug: 'producto-ac8',
          name: 'Producto de prueba',
          price_ars_cents: 100_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
  });

  const TODOS_LOS_ESTADOS = [
    'pending_payment',
    'new',
    'preparing',
    'ready',
    'delivered',
    'cancelled',
  ] as const;

  const idsPorEstado: Record<string, string> = {};

  async function sembrarLosSeis() {
    for (const status of TODOS_LOS_ESTADOS) {
      const orden = await prisma.order.create({
        data: {
          access_token_hash: `h-ac8-${status}`,
          buyer_name: 'Comprador de Prueba',
          buyer_email: `comprador-ac8-${status}@test.local`,
          buyer_phone: '+54 351 555 0000',
          total_ars_cents: 100_000,
          consent_accepted: true,
          consent_accepted_at: new Date(),
          consent_terms_version: '2026-06-15',
          status: 'pending_payment',
          items: {
            create: [
              {
                product_id: productId,
                quantity: 1,
                unit_price_ars_cents: 100_000,
                product_name: 'Producto de prueba',
                product_sku: 'AC8-A',
              },
            ],
          },
        },
      });
      if (status !== 'pending_payment') {
        await prisma.order.update({ where: { id: orden.id }, data: { status } });
      }
      idsPorEstado[status] = orden.id;
    }
  }

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken()}`);

  it('GET sin filtro devuelve exactamente las 4 activas de las 6 sembradas', async () => {
    await sembrarLosSeis();

    const res = await auth(request(app.getHttpServer()).get('/v1/admin/orders'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
    expect(res.body.data.map((o: { status: string }) => o.status).sort()).toEqual(
      ['delivered', 'new', 'preparing', 'ready'].sort(),
    );
  });

  it('GET .../{id} de la pending_payment → 404', async () => {
    await sembrarLosSeis();

    const res = await auth(
      request(app.getHttpServer()).get(`/v1/admin/orders/${idsPorEstado.pending_payment}`),
    );

    expect(res.status).toBe(404);
  });

  it('GET .../{id} de la cancelled → 200 (defensivo, OQ-BE-1)', async () => {
    await sembrarLosSeis();

    const res = await auth(
      request(app.getHttpServer()).get(`/v1/admin/orders/${idsPorEstado.cancelled}`),
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  // Nota de ejecución (2026-08-30): `bootstrap.ts` configura el `ValidationPipe`
  // global con `errorHttpStatusCode: UNPROCESSABLE_ENTITY` (422) — no 400 como
  // decía la prosa del plan (T7.1/T8.4). Es el código REAL que devuelve la app
  // hoy para toda violación de `class-validator`, verificado leyendo `bootstrap.ts`.
  it('filtro status=cancelled (fuera de la allowlist del DTO) → 422', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/v1/admin/orders').query({ status: 'cancelled' }),
    );

    expect(res.status).toBe(422);
  });

  it('filtro status=pending_payment (fuera de la allowlist del DTO) → 422', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/v1/admin/orders').query({ status: 'pending_payment' }),
    );

    expect(res.status).toBe(422);
  });
});
