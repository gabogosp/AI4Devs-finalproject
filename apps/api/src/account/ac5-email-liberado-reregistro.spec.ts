import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from './account.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaService } from '../prisma/prisma.service';
import { CSRF_COOKIE } from '../auth/cookies';

/**
 * T5.5 — AC-5: el email queda liberado tras el borrado, y el re-registro no
 * arrastra nada de la cuenta anterior (el vínculo con las órdenes es por
 * `customer_id`, no por email).
 */
describe('AC-5 — email liberado, re-registro limpio (ac5-email-liberado-reregistro)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'correo caballo batería grapa';
  const EMAIL = 'reciclado@example.com';
  const ORIGEN = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')[0];

  let ip = '';

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule, AccountModule, OrdersModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, customers RESTART IDENTITY CASCADE',
    );
    ip = nuevaIpDeTest();
  });

  const http = () => {
    const agente = request(app.getHttpServer());
    return {
      get: (r: string) => agente.get(r).set('X-Forwarded-For', ip),
      post: (r: string) => agente.post(r).set('X-Forwarded-For', ip),
      del: (r: string) => agente.delete(r).set('X-Forwarded-For', ip),
    };
  };

  const leerCsrf = (cookies: string[]): string =>
    cookies
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];

  async function registrar(email: string, name: string) {
    const res = await http()
      .post('/v1/auth/register')
      .send({ email, name, password: PASSWORD })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return { customerId: res.body.customer.id as string, cookies, csrf: leerCsrf(cookies) };
  }

  it('registro con el mismo email inmediatamente después de borrar: 201, id nuevo distinto, sin arrastrar órdenes viejas', async () => {
    const original = await registrar(EMAIL, 'Titular Original');

    await prisma.order.create({
      data: {
        access_token_hash: 'h-ac5-vieja',
        customer_id: original.customerId,
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 500_000,
        status: 'delivered',
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
      },
    });

    await http()
      .del('/v1/me')
      .set('Cookie', original.cookies)
      .set('X-CSRF-Token', original.csrf)
      .set('Origin', ORIGEN)
      .expect(204);

    const nuevo = await registrar(EMAIL, 'Titular Nuevo');

    expect(nuevo.customerId).not.toBe(original.customerId);

    const historial = await http()
      .get('/v1/me/orders')
      .set('Cookie', nuevo.cookies)
      .expect(200);
    expect(historial.body.data).toEqual([]);
  });
});
