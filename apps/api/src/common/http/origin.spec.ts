import { IncomingHttpHeaders } from 'node:http';
import { CsrfError } from '../errors/auth-errors';
import { verifyRequestOrigin } from './origin';

/**
 * US-007 T1.2 — la verificación de `Origin` extraída de `CsrfGuard`.
 *
 * El refactor es Extract Function sin cambio de comportamiento: los specs de CSRF
 * de auth (`csrf-guard.spec.ts`, `e2e-auth-csrf.spec.ts`) corren **sin editarse** y
 * son el guardarraíl. Estos casos son los mismos que ese guard ya garantizaba,
 * ahora ejercidos sin HTTP ni DI.
 */
const PERMITIDOS = ['https://dsm.com.ar', 'http://localhost:3200'];

const req = (headers: IncomingHttpHeaders) => ({ headers });

describe('verifyRequestOrigin (§7.5)', () => {
  describe('acepta', () => {
    it('un Origin exacto de la allowlist', () => {
      expect(() =>
        verifyRequestOrigin(req({ origin: 'https://dsm.com.ar' }), PERMITIDOS),
      ).not.toThrow();
    });

    it('sin Origin, un Referer cuyo ORIGEN está en la allowlist (ignora la ruta)', () => {
      expect(() =>
        verifyRequestOrigin(
          req({ referer: 'https://dsm.com.ar/carrito?x=1' }),
          PERMITIDOS,
        ),
      ).not.toThrow();
    });
  });

  describe('rechaza con CsrfError', () => {
    it('sin Origin ni Referer: no verificable ⇒ fail closed', () => {
      expect(() => verifyRequestOrigin(req({}), PERMITIDOS)).toThrow(CsrfError);
    });

    it('un Origin fuera de la allowlist', () => {
      expect(() =>
        verifyRequestOrigin(req({ origin: 'http://evil.example' }), PERMITIDOS),
      ).toThrow(CsrfError);
    });

    it('un Origin que es SUFIJO del permitido (dsm.com.ar.evil.net)', () => {
      // La comparación es por igualdad exacta justamente por este caso: cualquier
      // chequeo por sufijo lo aceptaría.
      expect(() =>
        verifyRequestOrigin(
          req({ origin: 'https://dsm.com.ar.evil.net' }),
          PERMITIDOS,
        ),
      ).toThrow(CsrfError);
    });

    it('un Referer que no parsea como URL', () => {
      expect(() =>
        verifyRequestOrigin(req({ referer: 'no-es-una-url' }), PERMITIDOS),
      ).toThrow(CsrfError);
    });

    it('un Referer de otro origen', () => {
      expect(() =>
        verifyRequestOrigin(
          req({ referer: 'http://evil.example/pagina' }),
          PERMITIDOS,
        ),
      ).toThrow(CsrfError);
    });
  });

  describe('precedencia y bordes', () => {
    it('prefiere Origin sobre Referer: Origin malo con Referer bueno ⇒ rechazo', () => {
      expect(() =>
        verifyRequestOrigin(
          req({
            origin: 'http://evil.example',
            referer: 'https://dsm.com.ar/carrito',
          }),
          PERMITIDOS,
        ),
      ).toThrow(CsrfError);
    });

    it('un Origin vacío cae al Referer, no se acepta como ausente-y-válido', () => {
      expect(() =>
        verifyRequestOrigin(
          req({ origin: '', referer: 'https://dsm.com.ar/x' }),
          PERMITIDOS,
        ),
      ).not.toThrow();
      expect(() => verifyRequestOrigin(req({ origin: '' }), PERMITIDOS)).toThrow(
        CsrfError,
      );
    });

    it('con allowlist vacía no pasa nada: sin orígenes declarados, nada es verificable', () => {
      expect(() =>
        verifyRequestOrigin(req({ origin: 'https://dsm.com.ar' }), []),
      ).toThrow(CsrfError);
    });
  });
});
