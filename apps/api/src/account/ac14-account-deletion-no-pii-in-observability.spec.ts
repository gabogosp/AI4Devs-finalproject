import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from './account.module';
import { PrismaService } from '../prisma/prisma.service';
import { AccountEventsService } from '../observability/account-events.service';
import { MetricsModule } from '../observability/metrics.module';
import { CSRF_COOKIE } from '../auth/cookies';

/**
 * T5.9 — AC-14: ni el nombre, ni el email, ni el teléfono sembrados
 * sobreviven en logs/eventos/respuestas de un `DELETE /v1/me` completo —
 * incluyendo el camino del 409 de bloqueo, que también toca el nombre/email
 * del cliente indirectamente (vía el customer bloqueado). Mismo estilo de
 * barrido "TODO lo que la corrida escribió" que `e2e-auth-observability.spec.ts`
 * (T9.1 de US-014) — no basta con mirar el evento que emitimos a propósito.
 */
describe('AC-14 — borrado de cuenta sin PII en observabilidad (ac14-account-deletion-no-pii-in-observability)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let eventos: AccountEventsService;

  const PASSWORD = 'correo caballo batería grapa';
  const NAME = 'Cliente Con Nombre Sembrado';
  const PHONE = '+54 351 555 9876';
  const ORIGEN = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')[0];

  let ip = '';
  let capturado: string[] = [];

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    // `MetricsModule` es @Global, pero igual tiene que entrar al grafo por
    // algún import explícito (mismo comentario que `e2e-search-observability`)
    // — sin esto, `AccountEventsService.count()` siempre da 0 porque su
    // `@Optional() metrics?` queda `undefined`.
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

    capturado = [];
    const capturar = (...args: unknown[]) => {
      capturado.push(args.map((a) => JSON.stringify(a)).join(' '));
    };
    for (const nivel of ['log', 'debug', 'warn', 'error', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation(capturar);
      jest.spyOn(Logger, nivel).mockImplementation(capturar);
    }
  });
  afterEach(() => jest.restoreAllMocks());

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

  async function registrar(email: string) {
    const res = await http()
      .post('/v1/auth/register')
      .send({ email, name: NAME, phone: PHONE, password: PASSWORD })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return { cookies, csrf: leerCsrf(cookies) };
  }

  it('borrado exitoso: ni nombre, ni email, ni teléfono aparecen en ningún log ni evento', async () => {
    const EMAIL = 'sembrado-exito@example.com';
    const sesion = await registrar(EMAIL);
    const antes = await eventos.count('account.deleted');

    const res = await http()
      .del('/v1/me')
      .set('Cookie', sesion.cookies)
      .set('X-CSRF-Token', sesion.csrf)
      .set('Origin', ORIGEN)
      .expect(204);

    const todo = capturado.join('\n');
    expect(todo).not.toContain(NAME);
    expect(todo).not.toContain(EMAIL);
    expect(todo).not.toContain(PHONE);
    // También en la respuesta HTTP (cookies + body): un 204 no tiene body,
    // pero las cookies de borrado tampoco deberían llevar nada sembrado.
    const cookiesRespuesta = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cookiesRespuesta).not.toContain(NAME);
    expect(cookiesRespuesta).not.toContain(EMAIL);
    expect(cookiesRespuesta).not.toContain(PHONE);

    // El registro operativo SÍ permite reconstruir que hubo un borrado, cuándo
    // y cuántas órdenes anonimizó — sin identificar a la persona (AC-14, 2ª cláusula).
    const lineaEvento = capturado.find((l) => l.includes('"event":"account.deleted"'));
    expect(lineaEvento).toBeDefined();
    expect(lineaEvento).toContain('"anonymized_orders":0');
    expect(lineaEvento).not.toContain(EMAIL);
    expect(lineaEvento).not.toContain(NAME);

    expect(await eventos.count('account.deleted')).toBe(antes + 1);
  });

  it('borrado bloqueado (409, orden en curso): tampoco aparece nombre/email/teléfono en logs ni en el body de la respuesta', async () => {
    const EMAIL = 'sembrado-bloqueo@example.com';
    const sesion = await registrar(EMAIL);
    const antesBloqueo = await eventos.count('account.deletion_blocked');

    const cliente = await prisma.customer.findUniqueOrThrow({ where: { email: EMAIL } });
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-ac14' },
    });
    const producto = await prisma.product.create({
      data: {
        sku: 'AC14-A',
        slug: 'compresor-ac14',
        name: 'Compresor',
        price_ars_cents: 850_000,
        stock: 10,
        status: 'published',
        category_id: cat.id,
      },
    });
    await prisma.order.create({
      data: {
        access_token_hash: 'h-ac14-bloqueo',
        customer_id: cliente.id,
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 850_000,
        status: 'preparing',
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
              product_sku: 'AC14-A',
            },
          ],
        },
      },
    });

    const res = await http()
      .del('/v1/me')
      .set('Cookie', sesion.cookies)
      .set('X-CSRF-Token', sesion.csrf)
      .set('Origin', ORIGEN)
      .expect(409);

    const todo = capturado.join('\n');
    expect(todo).not.toContain(NAME);
    expect(todo).not.toContain(EMAIL);
    expect(todo).not.toContain(PHONE);

    const cuerpo = JSON.stringify(res.body);
    expect(cuerpo).not.toContain(NAME);
    expect(cuerpo).not.toContain(EMAIL);
    expect(cuerpo).not.toContain(PHONE);

    const lineaBloqueo = capturado.find((l) => l.includes('"event":"account.deletion_blocked"'));
    expect(lineaBloqueo).toBeDefined();
    expect(lineaBloqueo).not.toContain(EMAIL);
    expect(lineaBloqueo).not.toContain(NAME);

    expect(await eventos.count('account.deletion_blocked')).toBe(antesBloqueo + 1);

    // La cuenta no cambió: sigue con el nombre/email sembrados en la base.
    const releido = await prisma.customer.findUniqueOrThrow({ where: { id: cliente.id } });
    expect(releido.deleted_at).toBeNull();
    expect(releido.name).toBe(NAME);
  });
});
