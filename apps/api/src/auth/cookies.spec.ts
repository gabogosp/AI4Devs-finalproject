import express, { Response } from 'express';
import request from 'supertest';
import {
  ACCESS_COOKIE,
  CART_COOKIE,
  CART_CSRF_COOKIE,
  clearCartCookies,
  clearSessionCookies,
  CSRF_COOKIE,
  deriveCsrfToken,
  REFRESH_COOKIE,
  setCartCookies,
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

/**
 * US-007 T1.1 — cookies del carrito del invitado. Mismo enfoque: se verifican los
 * `Set-Cookie` que salen por el cable, no los argumentos.
 */
describe('cookies del carrito del invitado (US-007, §7.4)', () => {
  const CART = { token: 'cart-token-abc', csrfToken: 'cart-csrf-def' };
  const CART_OPTS = { ttlDays: 7, secure: true };

  describe('setCartCookies', () => {
    it('emite exactamente las dos', async () => {
      const { cookies } = await emitir((res) =>
        setCartCookies(res, CART, CART_OPTS),
      );
      expect(cookies).toHaveLength(2);
      expect(buscar(cookies, CART_COOKIE)).toBeTruthy();
      expect(buscar(cookies, CART_CSRF_COOKIE)).toBeTruthy();
    });

    it('dsm_cart es HttpOnly y dsm_cart_csrf NO (double-submit)', async () => {
      const { cookies } = await emitir((res) =>
        setCartCookies(res, CART, CART_OPTS),
      );
      expect(buscar(cookies, CART_COOKIE)).toContain('HttpOnly');
      // El FE tiene que poder leerla para reenviarla en X-CSRF-Token; un
      // atacante en otro origen puede provocar que el navegador la mande, pero
      // no leerla.
      expect(buscar(cookies, CART_CSRF_COOKIE)).not.toContain('HttpOnly');
    });

    it('las dos llevan Path=/ y SameSite=Lax', async () => {
      const { cookies } = await emitir((res) =>
        setCartCookies(res, CART, CART_OPTS),
      );
      for (const n of [CART_COOKIE, CART_CSRF_COOKIE]) {
        expect(buscar(cookies, n)).toContain('Path=/;');
        expect(buscar(cookies, n)).toContain('SameSite=Lax');
      }
    });

    it('Max-Age = CART_TTL_DAYS × 86400 (7 días = 604800 s) en las dos', async () => {
      // Cookie y fila (`carts.expires_at`) se derivan del MISMO CART_TTL_DAYS:
      // así no puede quedar una cookie viva apuntando a una fila vencida.
      const { cookies } = await emitir((res) =>
        setCartCookies(res, CART, CART_OPTS),
      );
      for (const n of [CART_COOKIE, CART_CSRF_COOKIE]) {
        expect(buscar(cookies, n)).toContain('Max-Age=604800');
      }
    });

    it('el Max-Age se deriva del ttlDays recibido, no de una constante', async () => {
      const { cookies } = await emitir((res) =>
        setCartCookies(res, CART, { ttlDays: 1, secure: true }),
      );
      expect(buscar(cookies, CART_COOKIE)).toContain('Max-Age=86400');
    });

    it('con secure:false desaparece Secure; con true aparece', async () => {
      const sin = await emitir((res) =>
        setCartCookies(res, CART, { ...CART_OPTS, secure: false }),
      );
      for (const n of [CART_COOKIE, CART_CSRF_COOKIE]) {
        expect(buscar(sin.cookies, n)).not.toContain('Secure');
      }

      const con = await emitir((res) => setCartCookies(res, CART, CART_OPTS));
      for (const n of [CART_COOKIE, CART_CSRF_COOKIE]) {
        expect(buscar(con.cookies, n)).toContain('Secure');
      }
    });

    it('el token del carrito viaja SÓLO en la cookie', async () => {
      // No hay cuerpo de respuesta que lo lleve: la identidad es la cookie.
      const { cookies } = await emitir((res) =>
        setCartCookies(res, CART, CART_OPTS),
      );
      expect(buscar(cookies, CART_COOKIE)).toContain(CART.token);
      expect(buscar(cookies, CART_CSRF_COOKIE)).not.toContain(CART.token);
    });
  });

  describe('clearCartCookies', () => {
    it('borra las dos con Max-Age=0 y el mismo Path de emisión', async () => {
      const { cookies } = await emitir((res) => clearCartCookies(res, true));
      expect(cookies).toHaveLength(2);
      for (const n of [CART_COOKIE, CART_CSRF_COOKIE]) {
        const c = buscar(cookies, n);
        expect(c).toContain('Path=/;');
        expect(c).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
      }
    });
  });

  describe('las cookies de sesión de US-014 no cambian', () => {
    it('sigue emitiendo dsm_access, dsm_refresh y dsm_csrf idénticas', async () => {
      const { cookies } = await emitir((res) =>
        setSessionCookies(res, TOKENS, OPTS),
      );
      expect(cookies).toHaveLength(3);
      expect(buscar(cookies, ACCESS_COOKIE)).toContain('Max-Age=900');
      expect(buscar(cookies, REFRESH_COOKIE)).toContain('Path=/v1/auth');
      expect(buscar(cookies, CSRF_COOKIE)).not.toContain('HttpOnly');
      // Y ninguna cookie del carrito se cuela en el flujo de sesión.
      expect(cookies.some((c) => c.startsWith(`${CART_COOKIE}=`))).toBe(false);
    });

    it('clearSessionCookies no toca las del carrito', async () => {
      const { cookies } = await emitir((res) => clearSessionCookies(res, true));
      expect(cookies).toHaveLength(3);
      expect(
        cookies.some((c) => c.startsWith(`${CART_CSRF_COOKIE}=`)),
      ).toBe(false);
    });
  });
});
