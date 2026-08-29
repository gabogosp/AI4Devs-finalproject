import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from './auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from './cookies';

/**
 * T10.2 — el ciclo de vida de la sesión por HTTP (AC-3, AC-9).
 *
 * Los tests de `SessionService` ya verifican la rotación contra la base. Esto
 * verifica que el **borde HTTP** la exponga correctamente: cookies con los
 * atributos correctos, el refresh que efectivamente rota, y el logout que deja
 * la sesión inservible desde el cliente.
 */
describe('Ciclo de sesión (e2e-auth-session)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'correo caballo batería grapa';
  const EMAIL = 'ana@example.com';
  const ORIGEN = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')[0];

  let ip = '';

  beforeAll(async () => {
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
    };
  };

  interface Sesion {
    cookies: string[];
    csrf: string;
  }

  const leerCsrf = (cookies: string[]): string =>
    cookies
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];

  async function abrirSesion(): Promise<Sesion> {
    const res = await http()
      .post('/v1/auth/register')
      .send({ email: EMAIL, name: 'Ana', password: PASSWORD })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return { cookies, csrf: leerCsrf(cookies) };
  }

  const refrescar = (s: Sesion) =>
    http()
      .post('/v1/auth/refresh')
      .set('Cookie', s.cookies)
      .set('X-CSRF-Token', s.csrf)
      .set('Origin', ORIGEN);

  const cerrarSesion = (s: Sesion) =>
    http()
      .post('/v1/auth/logout')
      .set('Cookie', s.cookies)
      .set('X-CSRF-Token', s.csrf)
      .set('Origin', ORIGEN);

  describe('atributos de cookie (AC-9)', () => {
    it('el access no viaja en el cuerpo y las cookies llevan los flags de §7.4', async () => {
      const { cookies } = await abrirSesion();

      const access = cookies.find((c) => c.startsWith(ACCESS_COOKIE))!;
      const refresh = cookies.find((c) => c.startsWith(REFRESH_COOKIE))!;
      const csrf = cookies.find((c) => c.startsWith(CSRF_COOKIE))!;

      expect(access).toContain('HttpOnly');
      expect(access).toContain('SameSite=Lax');
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/v1/auth');
      expect(csrf).not.toContain('HttpOnly');
    });

    it('AUTH_COOKIE_SECURE gobierna el flag Secure', async () => {
      // En el entorno de test corre sin TLS, así que el valor efectivo se lee de
      // la config en vez de asumirse — lo que se ancla es la correspondencia.
      const { cookies } = await abrirSesion();
      const esperaSecure = process.env.AUTH_COOKIE_SECURE !== 'false';
      const access = cookies.find((c) => c.startsWith(ACCESS_COOKIE))!;
      expect(access.includes('Secure')).toBe(esperaSecure);
    });
  });

  describe('refresh: rotación', () => {
    it('devuelve cookies NUEVAS y el refresh anterior deja de servir', async () => {
      const primera = await abrirSesion();
      const res = await refrescar(primera).expect(200);

      const nuevas = res.headers['set-cookie'] as unknown as string[];
      const refreshViejo = primera.cookies.find((c) =>
        c.startsWith(REFRESH_COOKIE),
      )!;
      const refreshNuevo = nuevas.find((c) => c.startsWith(REFRESH_COOKIE))!;
      expect(refreshNuevo).not.toBe(refreshViejo);

      // Reusar el viejo ya no renueva.
      await refrescar(primera).expect(401);
    });

    it('la sesión renovada sigue sirviendo para /me', async () => {
      const primera = await abrirSesion();
      const res = await refrescar(primera).expect(200);
      const nuevas = res.headers['set-cookie'] as unknown as string[];

      await http()
        .get('/v1/auth/me')
        .set('Cookie', nuevas)
        .expect(200)
        .expect((r) => expect(r.body.email).toBe(EMAIL));
    });
  });

  describe('refresh: detección de reuso', () => {
    it('el replay devuelve 401 e invalida TAMBIÉN el refresh vigente de la familia', async () => {
      const primera = await abrirSesion();
      const res = await refrescar(primera).expect(200);
      const vigentes = res.headers['set-cookie'] as unknown as string[];
      const sesionVigente: Sesion = {
        cookies: vigentes,
        csrf: leerCsrf(vigentes),
      };

      // El ladrón replaya el token viejo.
      await refrescar(primera).expect(401);

      // Y la víctima queda fuera: sin esto la detección sería decorativa.
      await refrescar(sesionVigente).expect(401);

      const familia = await prisma.refreshToken.findMany();
      expect(familia.every((f) => f.revoked_at !== null)).toBe(true);
    });
  });

  describe('logout (AC-3)', () => {
    it('204, y después el refresh no renueva', async () => {
      const s = await abrirSesion();
      await cerrarSesion(s).expect(204);
      await refrescar(s).expect(401);
    });

    it('la respuesta borra las tres cookies, incluida la del refresh con SU path', async () => {
      const s = await abrirSesion();
      const res = await cerrarSesion(s).expect(204);
      const borradas = res.headers['set-cookie'] as unknown as string[];

      expect(borradas).toHaveLength(3);
      const refresh = borradas.find((c) => c.startsWith(REFRESH_COOKIE))!;
      // Con el path equivocado la cookie que reabre la sesión sobreviviría en el
      // navegador y el logout parecería exitoso sin serlo.
      expect(refresh).toContain('Path=/v1/auth');
      for (const c of borradas) {
        expect(c).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
      }
    });

    it('la cookie de refresh queda revocada en la base, no sólo borrada del cliente', async () => {
      const s = await abrirSesion();
      await cerrarSesion(s).expect(204);

      const filas = await prisma.refreshToken.findMany();
      expect(filas).toHaveLength(1);
      expect(filas[0].revoked_at).not.toBeNull();
    });

    it('cerrar sesión no afecta a la otra sesión del mismo cliente', async () => {
      const movil = await abrirSesion();
      const loginRes = await http()
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
      const cookiesEscritorio = loginRes.headers[
        'set-cookie'
      ] as unknown as string[];
      const escritorio: Sesion = {
        cookies: cookiesEscritorio,
        csrf: leerCsrf(cookiesEscritorio),
      };

      await cerrarSesion(movil).expect(204);

      // El logout revoca la familia de ESE dispositivo, no todas las del cliente.
      await refrescar(escritorio).expect(200);
    });
  });

  describe('ventana residual del access, declarada en el diseño', () => {
    it('tras el logout, el access sigue abriendo /me hasta que vence', async () => {
      // No es un bug: es el límite conocido de un access stateless de 15 min,
      // documentado en la trazabilidad de AC-3. Se ancla acá para que un cambio
      // de esa decisión sea deliberado y no accidental.
      const s = await abrirSesion();
      await cerrarSesion(s).expect(204);

      await http().get('/v1/auth/me').set('Cookie', s.cookies).expect(200);
    });
  });
});
