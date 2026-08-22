import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { CsrfError } from '../common/errors/auth-errors';
import { ACCESS_COOKIE, CART_COOKIE, deriveCsrfToken } from '../auth/cookies';
import { CSRF_HEADER } from '../auth/csrf.guard';
import { CartCsrfGuard } from './cart-csrf.guard';

const PERMITIDO = 'https://dsmferreteria.com.ar';
const config = new ConfigService({
  JWT_SECRET: 'secreto-csrf-carrito',
  CORS_ALLOWED_ORIGINS: `${PERMITIDO},http://localhost:3000`,
}) as ConfigService;
const SECRETO = config.getOrThrow<string>('JWT_SECRET');
const [ORIGEN_OK] = config.get<string>('CORS_ALLOWED_ORIGINS')!.split(',');

const guard = new CartCsrfGuard(config);

const TOKEN_DEL_CARRITO = 'token-opaco-del-carrito-abc';
const CSRF_CORRECTO = deriveCsrfToken(TOKEN_DEL_CARRITO, SECRETO);

function contexto(
  headers: Record<string, string>,
  cookies: Record<string, string> = { [CART_COOKIE]: TOKEN_DEL_CARRITO },
): ExecutionContext {
  const req = { headers, cookies } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const pasa = (ctx: ExecutionContext) => expect(guard.canActivate(ctx)).toBe(true);
const rechaza = (ctx: ExecutionContext) =>
  expect(() => guard.canActivate(ctx)).toThrow(CsrfError);

describe('CartCsrfGuard (§7.5 — double-submit sobre el token del carrito)', () => {
  it('con header correcto y Origin permitido, pasa', () =>
    pasa(contexto({ origin: ORIGEN_OK, [CSRF_HEADER]: CSRF_CORRECTO })));

  it('la PRIMERA escritura, sin cookie de carrito, pasa', () => {
    // No hay carrito que secuestrar ni valor que derivar: lo peor que consigue un
    // tercero es que la víctima estrene un carrito vacío. Exigir CSRF acá
    // rompería el primer «agregar al carrito» de todo cliente nuevo.
    pasa(contexto({}, {}));
  });

  describe('rechaza (con cookie de carrito presente)', () => {
    it('sin el header X-CSRF-Token → CsrfError', () =>
      rechaza(contexto({ origin: ORIGEN_OK })));

    it('con un valor que no corresponde al token presentado → CsrfError', () =>
      rechaza(
        contexto({ origin: ORIGEN_OK, [CSRF_HEADER]: 'inventado-por-mi' }),
      ));

    it('con el valor de OTRA sesión de carrito → CsrfError', () =>
      rechaza(
        contexto({
          origin: ORIGEN_OK,
          [CSRF_HEADER]: deriveCsrfToken('token-de-otro-carrito', SECRETO),
        }),
      ));

    it('con Origin fuera de la allowlist → CsrfError', () =>
      rechaza(
        contexto({
          origin: 'http://evil.example',
          [CSRF_HEADER]: CSRF_CORRECTO,
        }),
      ));

    it('SIN Origin ni Referer → CsrfError (fail closed)', () =>
      rechaza(contexto({ [CSRF_HEADER]: CSRF_CORRECTO })));
  });

  describe('el valor no se puede forjar sin JWT_SECRET', () => {
    it('derivado con otro secreto → CsrfError', () =>
      rechaza(
        contexto({
          origin: ORIGEN_OK,
          [CSRF_HEADER]: deriveCsrfToken(
            TOKEN_DEL_CARRITO,
            'secreto-del-atacante',
          ),
        }),
      ));

    it('un prefijo correcto no pasa (comparación en tiempo constante)', () =>
      rechaza(
        contexto({
          origin: ORIGEN_OK,
          [CSRF_HEADER]: CSRF_CORRECTO.slice(0, -1),
        }),
      ));
  });

  describe('aislamiento del CSRF de auth (US-014)', () => {
    it('el valor derivado del jti del access NO abre el carrito', () => {
      // Los dos mecanismos comparten HMAC y secreto, pero no sujeto: si el valor
      // de la sesión sirviera para el carrito, un XSS que leyera `dsm_csrf`
      // (legible por diseño) escribiría carritos ajenos.
      const jwt = new JwtService({});
      const jti = 'jti-de-la-sesion';
      const access = jwt.sign({ sub: 'c1', jti }, { secret: SECRETO });

      rechaza(
        contexto(
          { origin: ORIGEN_OK, [CSRF_HEADER]: deriveCsrfToken(jti, SECRETO) },
          { [CART_COOKIE]: TOKEN_DEL_CARRITO, [ACCESS_COOKIE]: access },
        ),
      );
    });

    it('el double-submit del carrito se deriva del token del carrito, no del access', () => {
      const jwt = new JwtService({});
      const access = jwt.sign({ sub: 'c1', jti: 'jti-x' }, { secret: SECRETO });

      pasa(
        contexto(
          { origin: ORIGEN_OK, [CSRF_HEADER]: CSRF_CORRECTO },
          { [CART_COOKIE]: TOKEN_DEL_CARRITO, [ACCESS_COOKIE]: access },
        ),
      );
    });
  });

  describe('Origin: respaldo por Referer', () => {
    it('un Referer de origen permitido sirve de respaldo', () =>
      pasa(
        contexto({
          referer: `${ORIGEN_OK}/carrito`,
          [CSRF_HEADER]: CSRF_CORRECTO,
        }),
      ));

    it('un sufijo del dominio permitido no cuela', () =>
      rechaza(
        contexto({
          origin: `${ORIGEN_OK}.evil.net`,
          [CSRF_HEADER]: CSRF_CORRECTO,
        }),
      ));
  });
});
