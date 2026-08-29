import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { AuthModule } from './auth.module';

/**
 * AC-8 — la costura HTTP del login admin (`POST /v1/admin/auth/login`).
 * Es la ruta que EMITE el token, así que es la única bajo `/v1/admin/*` sin
 * `AdminGuard`; los tests fijan ese contrato para que no se le agregue por error.
 */
describe('Login admin (e2e-admin-auth, AC-8)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootTestApp([AuthModule]);
  });
  afterAll(async () => {
    await app?.close();
  });

  const post = (body: object) =>
    request(app.getHttpServer()).post('/v1/admin/auth/login').send(body);

  it('bootstrap token válido → 200 con un JWT role=admin', async () => {
    const res = await post({
      bootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN,
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');

    const claims = new JwtService({}).verify<{ role: string }>(res.body.token, {
      secret: process.env.JWT_SECRET,
    });
    expect(claims.role).toBe('admin');
  });

  it('el token emitido abre las rutas gateadas por AdminGuard', async () => {
    const { body } = await post({
      bootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN,
    });
    const res = await request(app.getHttpServer())
      .get('/v1/admin/categories')
      .set('Authorization', `Bearer ${body.token}`);

    // No es 401/403: el token que emite el seam es el que el guard acepta.
    expect([200, 404]).toContain(res.status);
  });

  it('bootstrap token inválido → 401 RFC 7807 sin filtrar el token esperado', async () => {
    const res = await post({ bootstrapToken: 'no-es-el-token' });

    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/^dsm:catalog\//);
    expect(res.body.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(
      process.env.ADMIN_BOOTSTRAP_TOKEN,
    );
  });

  it('sin bootstrapToken → 422 por campo (ValidationPipe)', async () => {
    const res = await post({});

    expect(res.status).toBe(422);
    expect(res.body.errors?.[0]?.field).toBe('bootstrapToken');
  });

  it('la ruta de login NO exige Authorization (no es circular)', async () => {
    const res = await post({
      bootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN,
    });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
