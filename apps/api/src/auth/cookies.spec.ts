import express, { Response } from 'express';
import request from 'supertest';
import {
  ACCESS_COOKIE,
  clearSessionCookies,
  CSRF_COOKIE,
  deriveCsrfToken,
  REFRESH_COOKIE,
  setSessionCookies,
} from './cookies';

/**
 * T4.2 — se verifican los `Set-Cookie` **reales** que produce Express, no los
 * argumentos que le pasamos. Un test que espiara `res.cookie()` pasaría aunque
 * Express serializara algo distinto, y lo que protege al usuario es el header
 * que sale por el cable.
 */
function emitir(
  handler: (res: Response) => void,
): Promise<Record<string, string[]>> {
  const app = express();
  app.get('/', (_req, res) => {
    handler(res);
    res.status(204).end();
  });
  return request(app)
    .get('/')
    .then((r) => ({ cookies: r.headers['set-cookie'] as unknown as string[] }));
}

const TOKENS = {
  accessToken: 'access-abc',
  refreshToken: 'refresh-def',
  csrfToken: 'csrf-ghi',
};
const OPTS = { accessTtlMin: 15, refreshTtlDays: 30, secure: true };

const buscar = (cookies: string[], nombre: string): string =>
  cookies.find((c) => c.startsWith(`${nombre}=`))!;

describe('cookies de sesión (§7.4)', () => {
  describe('setSessionCookies', () => {
    it('emite exactamente las tres', async () => {
      const { cookies } = await emitir((res) =>
        setSessionCookies(res, TOKENS, OPTS),
      );
      expect(cookies).toHaveLength(3);
      for (const n of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
        expect(buscar(cookies, n)).toBeTruthy();
      }
    });

    it('dsm_access: HttpOnly, Secure, SameSite=Lax, Path=/ y Max-Age del TTL', async () => {
      const { cookies } = await emitir((res) =>
        setSessionCookies(res, TOKENS, OPTS),
      );
      const c = buscar(cookies, ACCESS_COOKIE);
      expect(c).toContain('HttpOnly');
      expect(c).toContain('Secure');
      expect(c).toContain('SameSite=Lax');
      expect(c).toContain('Path=/;');
      expect(c).toContain('Max-Age=900'); // 15 min en segundos
    });

    it('dsm_refresh: acotada a Path=/v1/auth — no viaja en cada petición al catálogo', async () => {
      const { cookies } = await emitir((res) =>
        setSessionCookies(res, TOKENS, OPTS),
      );
      const c = buscar(cookies, REFRESH_COOKIE);
      expect(c).toContain('Path=/v1/auth');
      expect(c).toContain('HttpOnly');
      expect(c).toContain('Max-Age=2592000'); // 30 días
    });

    it('dsm_csrf NO es HttpOnly: el frontend tiene que poder leerla', async () => {
      // Es el mecanismo del double-submit: el atacante puede provocar que el
      // navegador MANDE la cookie, pero no leerla para poner el header.
      const { cookies } = await emitir((res) =>
        setSessionCookies(res, TOKENS, OPTS),
      );
      const c = buscar(cookies, CSRF_COOKIE);
      expect(c).not.toContain('HttpOnly');
      expect(c).toContain('SameSite=Lax');
      expect(c).toContain('Secure');
    });

    it('las dos cookies de token SÍ son HttpOnly — ningún script las lee (AC-9)', async () => {
      const { cookies } = await emitir((res) =>
        setSessionCookies(res, TOKENS, OPTS),
      );
      expect(buscar(cookies, ACCESS_COOKIE)).toContain('HttpOnly');
      expect(buscar(cookies, REFRESH_COOKIE)).toContain('HttpOnly');
    });

    it('con AUTH_COOKIE_SECURE=false desaparece Secure (sólo para local sin TLS)', async () => {
      const { cookies } = await emitir((res) =>
        setSessionCookies(res, TOKENS, { ...OPTS, secure: false }),
      );
      for (const n of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
        expect(buscar(cookies, n)).not.toContain('Secure');
      }
    });
  });

  describe('clearSessionCookies', () => {
    it('borra las tres', async () => {
      const { cookies } = await emitir((res) => clearSessionCookies(res, true));
      expect(cookies).toHaveLength(3);
    });

    it('borra dsm_refresh con SU path: si no, sobrevive justo la que reabre la sesión', async () => {
      // Un navegador trata la misma cookie en `/` y en `/v1/auth` como dos
      // cookies distintas. Un logout que borre con el path equivocado parece
      // exitoso y no limpia nada.
      const { cookies } = await emitir((res) => clearSessionCookies(res, true));
      const c = buscar(cookies, REFRESH_COOKIE);
      expect(c).toContain('Path=/v1/auth');
      expect(c).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    });

    it('las tres salen vencidas', async () => {
      const { cookies } = await emitir((res) => clearSessionCookies(res, true));
      for (const c of cookies) {
        expect(c).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
      }
    });
  });

  describe('deriveCsrfToken (T4.4)', () => {
    const SECRETO = 'secreto-del-servidor';

    it('determinista: el mismo jti da el mismo valor — el guard puede recalcularlo', () => {
      const jti = 'jti-123';
      expect(deriveCsrfToken(jti, SECRETO)).toBe(deriveCsrfToken(jti, SECRETO));
    });

    it('jti distinto da valor distinto: el CSRF de otra sesión no sirve', () => {
      expect(deriveCsrfToken('jti-a', SECRETO)).not.toBe(
        deriveCsrfToken('jti-b', SECRETO),
      );
    });

    it('sin el secreto no se puede forjar', () => {
      expect(deriveCsrfToken('jti-123', SECRETO)).not.toBe(
        deriveCsrfToken('jti-123', 'otro-secreto'),
      );
    });

    it('base64url: viaja en un header sin escapar', () => {
      expect(deriveCsrfToken('jti-123', SECRETO)).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });
});
