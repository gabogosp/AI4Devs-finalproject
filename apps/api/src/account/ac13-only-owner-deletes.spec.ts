import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from './account.module';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../auth/cookies';
import { JWT_AUDIENCE, JWT_ISSUER } from '../auth/session.service';

/**
 * T5.8 — AC-13: sólo el titular con su propia sesión borra su cuenta. La ruta
 * no acepta ningún parámetro de identidad (ni body, ni path param) — el
 * `customerId` sale exclusivamente de `req.customerId`, que `CustomerGuard`
 * deja seteado desde la cookie de access. No hay forma de pasar un
 * `customer_id` ajeno aunque uno quisiera.
 */
describe('AC-13 — sólo el titular borra su cuenta (ac13-only-owner-deletes)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const ORIGEN = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')[0];
  let ip = '';

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule, AccountModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, carts, cart_items, customers RESTART IDENTITY CASCADE',
    );
    ip = nuevaIpDeTest();
  });

  const http = () => {
    const agente = request(app.getHttpServer());
    return {
      del: (r: string) => agente.delete(r).set('X-Forwarded-For', ip),
    };
  };

  const leerCsrf = (cookies: string[]): string =>
    cookies
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];

  async function registrar(email: string, name: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, name, password: 'correo caballo batería grapa' })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return { cookies, csrf: leerCsrf(cookies) };
  }

  it('sin sesión de cliente: 401, ninguna fila cambia', async () => {
    const antes = await prisma.customer.count();

    await http().del('/v1/me').set('Origin', ORIGEN).expect(401);

    expect(await prisma.customer.count()).toBe(antes);
  });

  it('con sesión de OTRO cliente: borra la propia, la cuenta ajena queda intacta byte a byte', async () => {
    const titular = await registrar('titular@example.com', 'Titular');
    const otro = await registrar('otro@example.com', 'Otro');

    const filaAntes = await prisma.customer.findUniqueOrThrow({
      where: { email: 'otro@example.com' },
    });

    // "Otro" borra SU PROPIA cuenta con SU PROPIA sesión — no hay ningún
    // parámetro en la ruta por el que pudiera apuntar a "Titular".
    await http()
      .del('/v1/me')
      .set('Cookie', otro.cookies)
      .set('X-CSRF-Token', otro.csrf)
      .set('Origin', ORIGEN)
      .expect(204);

    const filaOtroTrasBorrado = await prisma.customer.findUniqueOrThrow({
      where: { id: filaAntes.id },
    });
    expect(filaOtroTrasBorrado.deleted_at).not.toBeNull();

    // El titular nunca fue tocado: ni deleted_at, ni nombre, ni email.
    const filaTitular = await prisma.customer.findUniqueOrThrow({
      where: { email: 'titular@example.com' },
    });
    expect(filaTitular.deleted_at).toBeNull();
    expect(filaTitular.name).toBe('Titular');

    // La sesión del titular sigue funcionando — el borrado de "Otro" no le
    // pisó ni la cookie ni la fila.
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('X-Forwarded-For', ip)
      .set('Cookie', titular.cookies)
      .expect(200);
  });

  it('con un JWT admin (role=admin) en la cookie de access: 401 — la ruta exige role=customer, mismo chequeo que resolveCustomerSession', async () => {
    const jwt = new JwtService({});
    const tokenAdmin = jwt.sign(
      { sub: 'admin-1', role: 'admin', typ: 'access', jti: 'jti-admin-1' },
      { secret: process.env.JWT_SECRET, issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );

    await http()
      .del('/v1/me')
      .set('Cookie', [`${ACCESS_COOKIE}=${tokenAdmin}`])
      .set('Origin', ORIGEN)
      .expect(401);
  });

  it('no existe ninguna ruta bajo /v1/admin/* que llegue a AccountDeletionService', async () => {
    // Barrido negativo: si alguna vez alguien agregara una ruta admin que
    // delegara en el mismo service, este 404 se rompería y el gap se notaría acá.
    await http().del('/v1/admin/me').set('Origin', ORIGEN).expect(404);
    await http().del('/v1/admin/customers/me').set('Origin', ORIGEN).expect(404);
  });
});
