import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { CsrfGuard, CSRF_HEADER } from './csrf.guard';
import { CsrfError } from '../common/errors/auth-errors';
import { ACCESS_COOKIE, deriveCsrfToken } from './cookies';
import { JWT_AUDIENCE, JWT_ISSUER } from './session.service';

const PERMITIDO = 'https://panel.dsmferreteria.com.ar';
const config = new ConfigService({
  JWT_SECRET: 'secreto-csrf',
  CORS_ALLOWED_ORIGINS: `${PERMITIDO},http://localhost:3000`,
}) as ConfigService;
// Mismo motivo que en customer-guard.spec: process.env gana sobre el objeto.
const SECRETO = config.getOrThrow<string>('JWT_SECRET');
const ORIGENES = config.get<string>('CORS_ALLOWED_ORIGINS')!;
const [ORIGEN_OK] = ORIGENES.split(',');

const jwt = new JwtService({});
const guard = new CsrfGuard(jwt, config);

const JTI = 'jti-de-la-sesion';
const access = jwt.sign(
  { sub: 'cust-1', role: 'customer', typ: 'access', jti: JTI },
  {
    secret: SECRETO,
    expiresIn: '15m',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  },
);
const CSRF_CORRECTO = deriveCsrfToken(JTI, SECRETO);

function contexto(
  headers: Record<string, string>,
  cookies: Record<string, string> = { [ACCESS_COOKIE]: access },
): ExecutionContext {
  const req = { headers, cookies } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const pasa = (ctx: ExecutionContext) =>
  expect(guard.canActivate(ctx)).resolves.toBe(true);
const rechaza = (ctx: ExecutionContext) =>
  expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(CsrfError);

describe('CsrfGuard (§7.5 — double-submit firmado + Origin)', () => {
  it('con header correcto y Origin permitido, pasa', () =>
    pasa(contexto({ origin: ORIGEN_OK, [CSRF_HEADER]: CSRF_CORRECTO })));

  describe('double-submit', () => {
    it('sin el header X-CSRF-Token → rechazo', () =>
      rechaza(contexto({ origin: ORIGEN_OK })));

    it('con un valor arbitrario → rechazo', () =>
      rechaza(
        contexto({ origin: ORIGEN_OK, [CSRF_HEADER]: 'inventado-por-mi' }),
      ));

    it('con el CSRF de OTRA sesión → rechazo', () => {
      // Es el punto de derivarlo del jti: un valor válido de otra sesión no
      // sirve para ésta, así que robar un CSRF no alcanza.
      const deOtraSesion = deriveCsrfToken('otro-jti', SECRETO);
      return rechaza(
        contexto({ origin: ORIGEN_OK, [CSRF_HEADER]: deOtraSesion }),
      );
    });

    it('un valor derivado con otro secreto no sirve: sin JWT_SECRET no se forja', () =>
      rechaza(
        contexto({
          origin: ORIGEN_OK,
          [CSRF_HEADER]: deriveCsrfToken(JTI, 'secreto-del-atacante'),
        }),
      ));

    it('sin cookie de access no hay jti del que derivar → rechazo', () =>
      rechaza(
        contexto({ origin: ORIGEN_OK, [CSRF_HEADER]: CSRF_CORRECTO }, {}),
      ));

    it('un prefijo correcto del valor no pasa (comparación en tiempo constante)', () =>
      rechaza(
        contexto({
          origin: ORIGEN_OK,
          [CSRF_HEADER]: CSRF_CORRECTO.slice(0, -1),
        }),
      ));
  });

  describe('Origin', () => {
    it('un origen fuera de la allowlist → rechazo', () =>
      rechaza(
        contexto({
          origin: 'https://evil.example',
          [CSRF_HEADER]: CSRF_CORRECTO,
        }),
      ));

    it('SIN Origin ni Referer → rechazo (lo no verificable se rechaza)', () =>
      // §7.5: una escritura autenticada por cookie que no declara origen no es
      // verificable. Fail closed.
      rechaza(contexto({ [CSRF_HEADER]: CSRF_CORRECTO })));

    it('un sufijo del dominio permitido NO cuela', () =>
      // `https://panel.dsmferreteria.com.ar.evil.net` termina en el dominio
      // bueno: por eso la comparación es por igualdad exacta, como en CORS.
      rechaza(
        contexto({
          origin: `${ORIGEN_OK}.evil.net`,
          [CSRF_HEADER]: CSRF_CORRECTO,
        }),
      ));

    it('Referer de un origen permitido sirve de respaldo', () =>
      pasa(
        contexto({
          referer: `${ORIGEN_OK}/panel/productos`,
          [CSRF_HEADER]: CSRF_CORRECTO,
        }),
      ));

    it('Referer de un origen NO permitido → rechazo', () =>
      rechaza(
        contexto({
          referer: 'https://evil.example/pagina',
          [CSRF_HEADER]: CSRF_CORRECTO,
        }),
      ));

    it('un Referer que no parsea → rechazo, no excepción cruda', () =>
      rechaza(
        contexto({ referer: 'no-es-una-url', [CSRF_HEADER]: CSRF_CORRECTO }),
      ));

    it('Origin inválido gana sobre un Referer válido: no se cae al respaldo', () =>
      // Si el Referer pudiera rescatar un Origin rechazado, bastaría con
      // controlarlo para saltear la allowlist entera.
      rechaza(
        contexto({
          origin: 'https://evil.example',
          referer: `${ORIGEN_OK}/panel`,
          [CSRF_HEADER]: CSRF_CORRECTO,
        }),
      ));
  });
});
