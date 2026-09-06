import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from './account.module';
import { PrismaService } from '../prisma/prisma.service';
import { CSRF_COOKIE } from '../auth/cookies';

/**
 * T5.7 — AC-10: las 3 puertas de acceso quedan cerradas tras el borrado, cada
 * una probada explícitamente (`design.md` §Approach — "AC-10 — por qué las 3
 * puertas cierran").
 */
describe('AC-10 — las 3 puertas cerradas tras el borrado (ac10-three-doors-closed)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'correo caballo batería grapa';
  const EMAIL = 'tres-puertas@example.com';
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
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
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

  async function abrirSesion() {
    const res = await http()
      .post('/v1/auth/register')
      .send({ email: EMAIL, name: 'Titular', password: PASSWORD })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return { cookies, csrf: leerCsrf(cookies) };
  }

  async function borrarCuenta(s: { cookies: string[]; csrf: string }) {
    await http()
      .del('/v1/me')
      .set('Cookie', s.cookies)
      .set('X-CSRF-Token', s.csrf)
      .set('Origin', ORIGEN)
      .expect(204);
  }

  it('puerta 1 — login con las credenciales viejas: mismo cuerpo byte a byte que un email inexistente', async () => {
    const sesion = await abrirSesion();
    await borrarCuenta(sesion);

    const conCuentaBorrada = await http()
      .post('/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    const nuncaExistio = await http()
      .post('/v1/auth/login')
      .send({ email: 'nunca-existio@example.com', password: PASSWORD });

    expect(conCuentaBorrada.status).toBe(401);
    expect(conCuentaBorrada.body).toEqual(nuncaExistio.body);
    expect(conCuentaBorrada.body.type).toBe('dsm:auth/invalid-credentials');
  });

  it('puerta 2 — un refresh emitido ANTES del borrado, usado después: dsm:auth/invalid-refresh', async () => {
    const sesion = await abrirSesion();

    await borrarCuenta(sesion);

    // Simula la pestaña vieja de OTRO dispositivo: reenvía el jar de cookies
    // completo (access + refresh + csrf) tal como quedó ANTES del borrado — el
    // CsrfGuard deriva el token esperado del `jti` de la cookie de ACCESS, así
    // que reenviar sólo el refresh (sin access) dispara un 403 de CSRF antes de
    // siquiera llegar a la lógica de refresh, y no prueba lo que este AC pide.
    const res = await http()
      .post('/v1/auth/refresh')
      .set('Cookie', sesion.cookies)
      .set('X-CSRF-Token', sesion.csrf)
      .set('Origin', ORIGEN);

    expect(res.status).toBe(401);
    expect(res.body.type).toBe('dsm:auth/invalid-refresh');
  });

  it('puerta 3 — un password_reset_token emitido antes del borrado y no usado: dsm:auth/invalid-reset-token', async () => {
    const sesion = await abrirSesion();
    await http()
      .post('/v1/auth/password-reset/request')
      .send({ email: EMAIL })
      .expect(202);

    const tokenRow = await prisma.passwordResetToken.findFirstOrThrow({
      orderBy: { created_at: 'desc' },
    });
    // El claro nunca llega a la base (§ diseño de US-014): el test simula el
    // enlace que el cliente ya tenía en el email confirmando que, sin importar
    // el token exacto, la fila detrás de CUALQUIER token de esta cuenta deja
    // de existir tras el borrado — `deleteAllForCustomer` es un DELETE real.
    await borrarCuenta(sesion);

    const filaTrasElBorrado = await prisma.passwordResetToken.findUnique({
      where: { id: tokenRow.id },
    });
    expect(filaTrasElBorrado).toBeNull();

    const res = await http()
      .post('/v1/auth/password-reset/confirm')
      .send({ token: 'cualquier-token-de-esta-cuenta', password: 'otra caballo batería grapa' });

    expect(res.status).toBe(400); // InvalidResetTokenError.status (auth-errors.ts)
    expect(res.body.type).toBe('dsm:auth/invalid-reset-token');
  });
});
