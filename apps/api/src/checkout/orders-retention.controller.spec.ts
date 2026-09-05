import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, customerToken } from '../../test/e2e-app';
import { CheckoutModule } from './checkout.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T4.1-T4.3 — e2e-nest de la superficie admin de retención (US-021).
 */
describe('OrdersRetentionController (e2e-orders-retention)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    // `X-Forwarded-For` aísla el cubo de rate-limit por test (mismo patrón que
    // e2e-imports-security.spec.ts).
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([CheckoutModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
  });

  async function crearOrden(sufijo: string): Promise<string> {
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: `refrigeracion-${sufijo}` },
    });
    const producto = await prisma.product.create({
      data: {
        sku: `ORD-CTRL-${sufijo}`,
        slug: `compresor-${sufijo}`,
        name: 'Compresor Embraco',
        price_ars_cents: 12_500_000,
        stock: 3,
        status: 'published',
        category_id: cat.id,
      },
    });
    const orden = await prisma.order.create({
      data: {
        access_token_hash: `h-${sufijo}`,
        buyer_name: 'Comprador de Prueba',
        buyer_email: `comprador-${sufijo}@test.local`,
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 12_500_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: 1,
              unit_price_ars_cents: 12_500_000,
              product_name: 'Compresor Embraco',
              product_sku: `ORD-CTRL-${sufijo}`,
            },
          ],
        },
      },
    });
    return orden.id;
  }

  describe('POST /v1/admin/orders/:id/anonymize (T4.1)', () => {
    it('sin Authorization → 401', async () => {
      const id = await crearOrden('401');
      const res = await request(app.getHttpServer()).post(
        `/v1/admin/orders/${id}/anonymize`,
      );
      expect(res.status).toBe(401);
    });

    it('con JWT sin role=admin → 403', async () => {
      const id = await crearOrden('403');
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/orders/${id}/anonymize`)
        .set('Authorization', `Bearer ${customerToken()}`);
      expect(res.status).toBe(403);
    });

    it('con JWT admin sobre un id existente → 200 con order_id/anonymized_at/anonymization_reason', async () => {
      const id = await crearOrden('200');
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/orders/${id}/anonymize`)
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.order_id).toBe(id);
      expect(res.body.anonymization_reason).toBe('requested');
      expect(new Date(res.body.anonymized_at).toString()).not.toBe('Invalid Date');
    });

    it('sobre un id inexistente → 404 dsm:checkout/order-not-found', async () => {
      const inexistente = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/orders/${inexistente}/anonymize`)
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.type).toBe('dsm:checkout/order-not-found');
    });

    it('sobre un id ya anonimizado → 200 idéntico, sin error', async () => {
      const id = await crearOrden('idem');
      const primera = await request(app.getHttpServer())
        .post(`/v1/admin/orders/${id}/anonymize`)
        .set('Authorization', `Bearer ${adminToken()}`);
      const segunda = await request(app.getHttpServer())
        .post(`/v1/admin/orders/${id}/anonymize`)
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(segunda.status).toBe(200);
      expect(segunda.body.anonymized_at).toBe(primera.body.anonymized_at);
    });
  });

  describe('POST /v1/admin/orders/retention-sweep (T4.2)', () => {
    it('con JWT admin, anonimiza todo lo vencido y responde 200 con anonymized_count', async () => {
      const id = await crearOrden('sweep');
      const hace13Meses = new Date();
      hace13Meses.setMonth(hace13Meses.getMonth() - 13);
      await prisma.order.update({ where: { id }, data: { created_at: hace13Meses } });

      const res = await request(app.getHttpServer())
        .post('/v1/admin/orders/retention-sweep')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.anonymized_count).toBe(1);
      expect(res.body.reason).toBe('retention_policy');
    });

    it('sin role=admin → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/admin/orders/retention-sweep')
        .set('Authorization', `Bearer ${customerToken()}`);
      expect(res.status).toBe(403);
    });

    it('la sexta llamada dentro de la misma hora → 429 con Retry-After', async () => {
      const SWEEP_LIMIT = Number(process.env.ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX ?? 5);
      const IP = '10.7.0.1';
      const post = () =>
        request(app.getHttpServer())
          .post('/v1/admin/orders/retention-sweep')
          .set('Authorization', `Bearer ${adminToken()}`)
          .set('X-Forwarded-For', IP);

      for (let i = 0; i < SWEEP_LIMIT; i += 1) {
        const res = await post();
        expect(res.status).toBe(200);
      }

      const excedida = await post();
      expect(excedida.status).toBe(429);
      expect(excedida.headers['retry-after']).toBeDefined();
    });
  });
});
