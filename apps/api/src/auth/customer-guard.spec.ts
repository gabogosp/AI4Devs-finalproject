import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CustomerGuard, RequestConCliente } from './customer.guard';
import { UnauthenticatedError } from '../common/errors/auth-errors';
import { ACCESS_COOKIE } from './cookies';
import { JWT_AUDIENCE, JWT_ISSUER } from './session.service';

const config = new ConfigService({
  JWT_SECRET: 'secreto-de-test-para-el-guard',
}) as ConfigService;
// `ConfigService` prioriza `process.env` sobre el objeto del constructor, y el
// setup de jest define `JWT_SECRET`. El test firma con **el mismo** secreto que
// el guard verifica; si no, "firma inválida" haría pasar el test por el motivo
// equivocado — verde por rechazar, no por aceptar correctamente.
const SECRETO = config.getOrThrow<string>('JWT_SECRET');
const jwt = new JwtService({});
const guard = new CustomerGuard(jwt, config);

/** Contexto de ejecución mínimo con las cookies dadas. */
function contexto(cookies: Record<string, string>): {
  ctx: ExecutionContext;
  req: RequestConCliente;
} {
  const req = { cookies } as unknown as RequestConCliente;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function firmar(
  claims: Record<string, unknown>,
  opciones: Record<string, unknown> = {},
): string {
  return jwt.sign(claims, {
    secret: SECRETO,
    expiresIn: '15m',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    ...opciones,
  });
}

const CLAIMS_VALIDOS = {
  sub: 'cust-1',
  role: 'customer',
  typ: 'access',
  jti: 'jti-1',
};

describe('CustomerGuard (§3.3, §3.8 — fail closed)', () => {
  describe('camino feliz', () => {
    it('deja pasar y expone customerId y jti al handler', async () => {
      const { ctx, req } = contexto({
        [ACCESS_COOKIE]: firmar(CLAIMS_VALIDOS),
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.customerId).toBe('cust-1');
      expect(req.accessJti).toBe('jti-1');
    });
  });

  describe('rechaza — cada rama termina en 401, ninguna deja pasar', () => {
    const rechaza = async (cookies: Record<string, string>) => {
      const { ctx } = contexto(cookies);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    };

    it('sin cookie de access', () => rechaza({}));

    it('cookie vacía', () => rechaza({ [ACCESS_COOKIE]: '' }));

    it('token que no es un JWT', () =>
      rechaza({ [ACCESS_COOKIE]: 'esto-no-es-un-jwt' }));

    it('firmado con OTRO secreto', () =>
      rechaza({
        [ACCESS_COOKIE]: jwt.sign(CLAIMS_VALIDOS, {
          secret: 'secreto-del-atacante',
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        }),
      }));

    it('vencido', () =>
      rechaza({ [ACCESS_COOKIE]: firmar(CLAIMS_VALIDOS, { expiresIn: '-1s' }) }));

    it('issuer que no coincide', () =>
      rechaza({ [ACCESS_COOKIE]: firmar(CLAIMS_VALIDOS, { issuer: 'otro' }) }));

    it('audience que no coincide', () =>
      rechaza({
        [ACCESS_COOKIE]: firmar(CLAIMS_VALIDOS, { audience: 'otro-publico' }),
      }));

    it('typ="refresh" en la cookie de access', () =>
      // Un refresh vive 30 días contra 15 minutos: sin este chequeo, la ventana
      // de una fuga se multiplicaría por 2880.
      rechaza({
        [ACCESS_COOKIE]: firmar({ ...CLAIMS_VALIDOS, typ: 'refresh' }),
      }));

    it('role="admin" NO abre las rutas de cliente (seam de ADR-0009)', () =>
      rechaza({ [ACCESS_COOKIE]: firmar({ ...CLAIMS_VALIDOS, role: 'admin' }) }));

    it('sin sub', () =>
      rechaza({
        [ACCESS_COOKIE]: firmar({ role: 'customer', typ: 'access', jti: 'j' }),
      }));

    it('sin jti — el CSRF no podría derivarse', () =>
      rechaza({
        [ACCESS_COOKIE]: firmar({ sub: 's', role: 'customer', typ: 'access' }),
      }));

    it('con alg="none" (confusión de algoritmo)', async () => {
      // Cabecera `{"alg":"none"}` + payload + firma vacía: el ataque clásico que
      // el pin de algoritmo cierra.
      const cabecera = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const cuerpo = Buffer.from(
        JSON.stringify({
          ...CLAIMS_VALIDOS,
          iss: JWT_ISSUER,
          aud: JWT_AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 900,
        }),
      ).toString('base64url');
      await rechaza({ [ACCESS_COOKIE]: `${cabecera}.${cuerpo}.` });
    });

    it('el token del header Authorization NO sirve: sólo cuenta la cookie', async () => {
      // Si el guard aceptara el header, un XSS podría usar el token robado y
      // toda la protección de httpOnly no serviría de nada.
      const req = {
        cookies: {},
        headers: { authorization: `Bearer ${firmar(CLAIMS_VALIDOS)}` },
      } as unknown as RequestConCliente;
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });

    it('cookies ausente por completo (app sin cookie-parser) no hace pasar', async () => {
      const req = {} as unknown as RequestConCliente;
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });
  });

  it('todos los rechazos dan el MISMO error: el motivo no se filtra', async () => {
    const motivos = ['', 'no-jwt', firmar(CLAIMS_VALIDOS, { expiresIn: '-1s' })];
    const errores = await Promise.all(
      motivos.map((t) =>
        guard
          .canActivate(contexto({ [ACCESS_COOKIE]: t }).ctx)
          .catch((e: Error) => e.message),
      ),
    );
    expect(new Set(errores).size).toBe(1);
  });
});
