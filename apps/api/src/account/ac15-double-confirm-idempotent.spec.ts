import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from './account.module';
import { PrismaService } from '../prisma/prisma.service';
import { AccountEventsService } from '../observability/account-events.service';
import { MetricsModule } from '../observability/metrics.module';
import { CSRF_COOKIE } from '../auth/cookies';

/**
 * T5.10 — AC-15: confirmar el borrado dos veces (doble clic, o dos pestañas
 * con la misma sesión) produce un solo efecto. La guarda de idempotencia es
 * `customers.anonymize`'s `WHERE deleted_at IS NULL` — mismo idioma
 * estructural que US-021 (guardar por columna, nunca por
 * `Idempotency-Key`), documentado en `account-deletion.service.ts`.
 */
describe('AC-15 — doble confirmación produce un solo efecto (ac15-double-confirm-idempotent)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let eventos: AccountEventsService;

  const PASSWORD = 'correo caballo batería grapa';
  const ORIGEN = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')[0];

  let ip = '';

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule, AccountModule, MetricsModule]);
    prisma = app.get(PrismaService);
    eventos = app.get(AccountEventsService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, carts, cart_items, customers, products, categories RESTART IDENTITY CASCADE',
    );
    ip = nuevaIpDeTest();
  });

  const http = () => {
    const agente = request(app.getHttpServer());
    return {
      post: (r: string) => agente.post(r).set('X-Forwarded-For', ip),
      del: (r: string) => agente.delete(r).set('X-Forwarded-For', ip),
    };
  };

  const leerCsrf = (cookies: string[]): string =>
    cookies
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];

  async function registrarConOrdenEntregada(email: string) {
    const res = await http()
      .post('/v1/auth/register')
      .send({ email, name: 'Doble Confirmación', password: PASSWORD })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const csrf = leerCsrf(cookies);

    const cliente = await prisma.customer.findUniqueOrThrow({ where: { email } });
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: `refrigeracion-ac15-${cliente.id}` },
    });
    const producto = await prisma.product.create({
      data: {
        sku: `AC15-${cliente.id.slice(0, 8)}`,
        slug: `compresor-ac15-${cliente.id}`,
        name: 'Compresor',
        price_ars_cents: 850_000,
        stock: 10,
        status: 'published',
        category_id: cat.id,
      },
    });
    // `delivered` no bloquea (AC-4/AC-9) — así la 1ª confirmación anonimiza
    // exactamente 1 orden, y la 2ª tiene algo real para NO duplicar.
    await prisma.order.create({
      data: {
        access_token_hash: `h-ac15-${cliente.id}`,
        customer_id: cliente.id,
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 850_000,
        status: 'delivered',
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: 1,
              unit_price_ars_cents: 850_000,
              product_name: 'Compresor',
              product_sku: 'AC15-A',
            },
          ],
        },
      },
    });

    return { cliente, cookies, csrf };
  }

  it('dos DELETE secuenciales con la misma cookie: ambos 204, deleted_at no cambia entre el 1º y el 2º, sólo 1 orden anonimizada, contador +1 (no +2)', async () => {
    const { cliente, cookies, csrf } = await registrarConOrdenEntregada(
      'doble-secuencial@example.com',
    );
    const antes = await eventos.count('account.deleted');

    await http()
      .del('/v1/me')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .set('Origin', ORIGEN)
      .expect(204);

    const trasPrimera = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
    expect(trasPrimera.deleted_at).not.toBeNull();

    await http()
      .del('/v1/me')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .set('Origin', ORIGEN)
      .expect(204);

    const trasSegunda = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
    // Mismo instante exacto: la 2ª confirmación no volvió a escribir la fila.
    expect(trasSegunda.deleted_at?.getTime()).toBe(trasPrimera.deleted_at?.getTime());

    const ordenes = await prisma.order.findMany({ where: { customer_id: cliente.id } });
    expect(ordenes).toHaveLength(1);
    expect(ordenes[0].anonymized_at).not.toBeNull();
    // Y no hay un 2º `anonymized_at` distinto: la 2ª pasada nunca tocó la orden.
    expect(ordenes[0].anonymization_reason).toBe('account_deletion');

    expect(await eventos.count('account.deleted')).toBe(antes + 1);
  });

  it('dos DELETE concurrentes (Promise.all, misma cookie — simula dos pestañas): ambos 204, un solo efecto', async () => {
    const { cliente, cookies, csrf } = await registrarConOrdenEntregada(
      'doble-concurrente@example.com',
    );
    const antes = await eventos.count('account.deleted');

    const disparar = () =>
      http()
        .del('/v1/me')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .set('Origin', ORIGEN);

    const [r1, r2] = await Promise.all([disparar(), disparar()]);

    expect(r1.status).toBe(204);
    expect(r2.status).toBe(204);

    const releido = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
    expect(releido.deleted_at).not.toBeNull();

    const ordenes = await prisma.order.findMany({ where: { customer_id: cliente.id } });
    expect(ordenes).toHaveLength(1);
    expect(ordenes[0].anonymized_at).not.toBeNull();

    expect(await eventos.count('account.deleted')).toBe(antes + 1);
  });
});
