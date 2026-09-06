import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, deriveCsrfToken } from '../auth/cookies';
import { JWT_AUDIENCE, JWT_ISSUER } from '../auth/session.service';
import { parseCorsOrigins } from '../config/env.validation';
import { AccountModule } from './account.module';

/**
 * T4.2/T4.1 — supertest contra Postgres real, mismo estilo que
 * `orders-history.controller.spec.ts`/`e2e-auth-csrf.spec.ts`: `bootTestApp([AccountModule])`,
 * sin mocks de Prisma. Cubre el borde HTTP (401/403/409/429) y el shape 204.
 */
describe('AccountController (e2e, US-020 T4.1/T4.2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productoId = '';
  const jwt = new JwtService({});
  const ORIGEN_OK = parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS ?? '')[0];

  let ip = '';

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AccountModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, carts, cart_items, refresh_tokens, password_reset_tokens, customers, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-e2e-account' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'E2E-ACC-A',
          slug: 'producto-e2e-account',
          name: 'Producto de prueba',
          price_ars_cents: 100_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    ip = nuevaIpDeTest();
  });

  const JTI = 'jti-test-account';

  function accessCookie(customerId: string, jti: string = JTI): string {
    const token = jwt.sign(
      { sub: customerId, role: 'customer', typ: 'access', jti },
      { secret: process.env.JWT_SECRET, issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
    return `${ACCESS_COOKIE}=${token}`;
  }

  function csrfHeader(jti: string = JTI): string {
    return deriveCsrfToken(jti, process.env.JWT_SECRET as string);
  }

  function http() {
    const agente = request(app.getHttpServer());
    return {
      del: (r: string) => agente.delete(r).set('X-Forwarded-For', ip),
    };
  }

  async function crearCliente(sufijo: string) {
    return prisma.customer.create({
      data: {
        email: `cliente-${sufijo}@test.local`,
        password_hash: 'hash-de-prueba',
        name: `Cliente ${sufijo}`,
      },
    });
  }

  async function crearOrdenDe(customerId: string, status: string) {
    return prisma.order.create({
      data: {
        access_token_hash: `h-acc-ctrl-${Math.random()}`,
        customer_id: customerId,
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 100_000,
        status,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: productoId,
              quantity: 1,
              unit_price_ars_cents: 100_000,
              product_name: 'Producto de prueba',
              product_sku: 'E2E-ACC-A',
            },
          ],
        },
      },
    });
  }

  describe('DELETE /v1/me', () => {
    it('sin cookie: 401 antes de ejecutar el handler', async () => {
      const res = await http().del('/v1/me').set('Origin', ORIGEN_OK);
      expect(res.status).toBe(401);
    });

    it('con sesión pero sin X-CSRF-Token: 403', async () => {
      const cliente = await crearCliente('sin-csrf');
      const res = await http()
        .del('/v1/me')
        .set('Cookie', accessCookie(cliente.id))
        .set('Origin', ORIGEN_OK);
      expect(res.status).toBe(403);
    });

    it('con sesión válida y sin órdenes bloqueantes: 204, cookies de sesión limpias', async () => {
      const cliente = await crearCliente('happy');

      const res = await http()
        .del('/v1/me')
        .set('Cookie', accessCookie(cliente.id))
        .set('X-CSRF-Token', csrfHeader())
        .set('Origin', ORIGEN_OK);

      expect(res.status).toBe(204);
      const setCookie = res.headers['set-cookie'] as unknown as string[];
      expect(setCookie.some((c) => c.startsWith(`${ACCESS_COOKIE}=;`))).toBe(true);
      expect(setCookie.some((c) => c.startsWith(`${REFRESH_COOKIE}=;`))).toBe(true);
      expect(setCookie.some((c) => c.startsWith(`${CSRF_COOKIE}=;`))).toBe(true);

      const releido = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(releido.deleted_at).not.toBeNull();
    });

    it('con una orden bloqueante: 409 con blocking_orders, la cuenta NO queda borrada', async () => {
      const cliente = await crearCliente('blocked');
      await crearOrdenDe(cliente.id, 'new');

      const res = await http()
        .del('/v1/me')
        .set('Cookie', accessCookie(cliente.id))
        .set('X-CSRF-Token', csrfHeader())
        .set('Origin', ORIGEN_OK);

      expect(res.status).toBe(409);
      expect(res.body.type).toBe('dsm:account/active-orders');
      expect(res.body.blocking_orders).toHaveLength(1);
      expect(res.body.blocking_orders[0]).toMatchObject({ status: 'new' });

      const releido = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(releido.deleted_at).toBeNull();
    });

    it('segunda llamada sobre la misma cuenta ya borrada: 204 idéntico, sin error', async () => {
      const cliente = await crearCliente('doble');

      await http()
        .del('/v1/me')
        .set('Cookie', accessCookie(cliente.id))
        .set('X-CSRF-Token', csrfHeader())
        .set('Origin', ORIGEN_OK)
        .expect(204);

      const res = await http()
        .del('/v1/me')
        .set('Cookie', accessCookie(cliente.id))
        .set('X-CSRF-Token', csrfHeader())
        .set('Origin', ORIGEN_OK);
      expect(res.status).toBe(204);
    });

    it('sobre exceder el límite de account_deletion: 429 con Retry-After/RateLimit-* (T4.1)', async () => {
      const max = Number(process.env.ACCOUNT_DELETION_RATE_LIMIT_MAX ?? 5);
      const cliente = await crearCliente('throttle');

      let ultima: request.Response | undefined;
      for (let i = 0; i <= max; i += 1) {
        ultima = await http()
          .del('/v1/me')
          .set('Cookie', accessCookie(cliente.id))
          .set('X-CSRF-Token', csrfHeader())
          .set('Origin', ORIGEN_OK);
      }

      expect(ultima?.status).toBe(429);
      expect(ultima?.headers['retry-after']).toBeDefined();
      expect(ultima?.headers['ratelimit-limit']).toBeDefined();
    });
  });
});
