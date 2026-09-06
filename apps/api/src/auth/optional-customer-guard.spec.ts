import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OptionalCustomerGuard } from './resolve-customer-session';
import { RequestConCliente } from './customer.guard';
import { ACCESS_COOKIE } from './cookies';
import { JWT_AUDIENCE, JWT_ISSUER } from './session.service';

const config = new ConfigService({
  JWT_SECRET: 'secreto-de-test-para-el-guard-opcional',
}) as ConfigService;
const SECRETO = config.getOrThrow<string>('JWT_SECRET');
const jwt = new JwtService({});
const guard = new OptionalCustomerGuard(jwt, config);

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

describe('OptionalCustomerGuard (US-015, design.md §D1 — excepción fail-open documentada)', () => {
  it('sin cookie: deja pasar sin setear customerId', async () => {
    const { ctx, req } = contexto({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.customerId).toBeUndefined();
    expect(req.accessJti).toBeUndefined();
  });

  it('cookie inválida/vencida: deja pasar sin setear customerId', async () => {
    const { ctx, req } = contexto({
      [ACCESS_COOKIE]: firmar(CLAIMS_VALIDOS, { expiresIn: '-1s' }),
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.customerId).toBeUndefined();
  });

  it('cookie de rol "admin" (no "customer"): deja pasar sin setear customerId', async () => {
    const { ctx, req } = contexto({
      [ACCESS_COOKIE]: firmar({ ...CLAIMS_VALIDOS, role: 'admin' }),
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.customerId).toBeUndefined();
  });

  it('cookie de cliente válida: deja pasar y setea customerId/accessJti', async () => {
    const { ctx, req } = contexto({
      [ACCESS_COOKIE]: firmar(CLAIMS_VALIDOS),
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.customerId).toBe('cust-1');
    expect(req.accessJti).toBe('jti-1');
  });
});
