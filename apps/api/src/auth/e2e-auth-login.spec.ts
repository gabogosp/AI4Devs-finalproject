import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from './auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from './cookies';

/**
 * T5.2 — las siete rutas existen y el login emite sesión por cookie (AC-2, AC-9).
 */
describe('Seam de auth de cliente (e2e-auth-login)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'correo caballo batería grapa';
  const EMAIL = 'ana@example.com';

  let ip = '';

  beforeAll(async () => {
    // Ver `nuevaIpDeTest`: sin esto la suite agota el presupuesto de T6.1.
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule]);
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
      options: (r: string) => agente.options(r).set('X-Forwarded-For', ip),
    };
  };
  const registrar = () =>
    http()
      .post('/v1/auth/register')
      .send({ email: EMAIL, name: 'Ana', password: PASSWORD });

  const cookiesDe = (res: request.Response): string[] =>
    (res.headers['set-cookie'] as unknown as string[]) ?? [];
  const valorDe = (cookies: string[], nombre: string): string | undefined =>
    cookies
      .find((c) => c.startsWith(`${nombre}=`))
      ?.split(';')[0]
      .split('=')[1];

  describe('las 7 rutas existen', () => {
    // Un 404 de ruta acá significaría que el controller no quedó cableado. Se
    // acepta cualquier otro código: lo que se verifica es la EXISTENCIA.
    const rutas: Array<['post' | 'get', string]> = [
      ['post', '/v1/auth/register'],
      ['post', '/v1/auth/login'],
      ['post', '/v1/auth/refresh'],
      ['post', '/v1/auth/logout'],
      ['get', '/v1/auth/me'],
      ['post', '/v1/auth/password-reset/request'],
      ['post', '/v1/auth/password-reset/confirm'],
    ];

    it.each(rutas)('%s %s no devuelve 404', async (metodo, ruta) => {
      const res = await http()[metodo](ruta).send({});
      expect(res.status).not.toBe(404);
    });
  });

  describe('login (AC-2)', () => {
    it('200 con las tres cookies y SIN token en el cuerpo (AC-9)', async () => {
      await registrar().expect(201);
      const res = await http()
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);

      const c = cookiesDe(res);
      const access = valorDe(c, ACCESS_COOKIE);
      expect(access).toBeTruthy();
      expect(valorDe(c, REFRESH_COOKIE)).toBeTruthy();
      expect(valorDe(c, CSRF_COOKIE)).toBeTruthy();

      const cuerpo = JSON.stringify(res.body);
      expect(cuerpo).not.toContain(access!);
      expect(cuerpo).not.toContain(PASSWORD);
      expect(cuerpo).not.toContain('$2b$');
    });

    it('las cookies de token son HttpOnly y la de CSRF no (§7.4)', async () => {
      await registrar();
      const c = cookiesDe(
        await http()
          .post('/v1/auth/login')
          .send({ email: EMAIL, password: PASSWORD }),
      );
      expect(c.find((x) => x.startsWith(ACCESS_COOKIE))).toContain('HttpOnly');
      expect(c.find((x) => x.startsWith(REFRESH_COOKIE))).toContain('HttpOnly');
      expect(c.find((x) => x.startsWith(CSRF_COOKIE))).not.toContain('HttpOnly');
    });

    it('el login NO exige CSRF: todavía no hay sesión que secuestrar', async () => {
      await registrar();
      await http()
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
    });

    it('contraseña incorrecta → 401 dsm:auth/invalid-credentials', async () => {
      await registrar();
      const res = await http()
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: 'otra cosa' })
        .expect(401);
      expect(res.body.type).toBe('dsm:auth/invalid-credentials');
      expect(cookiesDe(res)).toHaveLength(0);
    });

    it('email inexistente da EXACTAMENTE el mismo cuerpo que contraseña mala (AC-5)', async () => {
      await registrar();
      const mala = await http()
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: 'otra cosa' });
      const inexistente = await http()
        .post('/v1/auth/login')
        .send({ email: 'nadie@example.com', password: PASSWORD });

      expect(inexistente.status).toBe(mala.status);
      expect(inexistente.body).toEqual(mala.body);
    });
  });

  describe('GET /v1/auth/me', () => {
    it('con la cookie de sesión → 200 con el email', async () => {
      const alta = await registrar().expect(201);
      const res = await http()
        .get('/v1/auth/me')
        .set('Cookie', cookiesDe(alta))
        .expect(200);
      expect(res.body.email).toBe(EMAIL);
      expect(Object.keys(res.body).sort()).toEqual([
        'created_at',
        'email',
        'id',
        'name',
        'phone',
      ]);
    });

    it('sin cookie → 401 dsm:auth/unauthenticated', async () => {
      const res = await http().get('/v1/auth/me').expect(401);
      expect(res.body.type).toBe('dsm:auth/unauthenticated');
    });

    it('con una cookie de access basura → 401', async () => {
      await http()
        .get('/v1/auth/me')
        .set('Cookie', [`${ACCESS_COOKIE}=no-es-un-jwt`])
        .expect(401);
    });

    it('un token de ADMIN no abre las rutas de cliente (seam de ADR-0009)', async () => {
      const { JwtService } = await import('@nestjs/jwt');
      const adminAccess = new JwtService({}).sign(
        { sub: 'admin', role: 'admin', typ: 'access', jti: 'j' },
        { secret: process.env.JWT_SECRET, expiresIn: '15m' },
      );
      await http()
        .get('/v1/auth/me')
        .set('Cookie', [`${ACCESS_COOKIE}=${adminAccess}`])
        .expect(401);
    });
  });

  describe('las rutas admin de US-001 siguen intactas', () => {
    it('POST /v1/admin/auth/login sigue respondiendo', async () => {
      const res = await http()
        .post('/v1/admin/auth/login')
        .send({ bootstrapToken: 'incorrecto' });
      // 401 (token malo) o 503 (auth deshabilitada), nunca 404: la ruta existe.
      expect([401, 503]).toContain(res.status);
    });
  });
});
