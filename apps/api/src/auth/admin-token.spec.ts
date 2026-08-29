import {
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminAuthService } from './admin-auth.service';
import { CredentialsService } from './credentials.service';
import { AdminGuard } from './admin.guard';

const SECRET = 'test-secret';
const BOOTSTRAP = 'seed-token';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    JWT_SECRET: SECRET,
    ADMIN_AUTH_ENABLED: 'true',
    ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP,
    ...overrides,
  };
  return {
    get: (k: string) => values[k],
    getOrThrow: (k: string) => values[k],
  } as unknown as ConfigService;
}

function contextWith(authorization: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext;
}

describe('AdminAuthService seam (admin-token)', () => {
  const jwt = new JwtService({});
  // Estos tests cubren el camino de bootstrap, que no toca credenciales; el
  // login por credenciales se verifica en e2e-auth-admin-credentials (T8.1).
  const credenciales = {} as unknown as CredentialsService;

  it('issueAdminToken emite un JWT con role=admin', () => {
    const svc = new AdminAuthService(jwt, makeConfig(), credenciales);
    const token = svc.issueAdminToken();
    const decoded = jwt.verify<{ role: string }>(token, { secret: SECRET });
    expect(decoded.role).toBe('admin');
  });

  it('el token emitido es aceptado por AdminGuard', async () => {
    const config = makeConfig();
    const svc = new AdminAuthService(jwt, config, credenciales);
    const guard = new AdminGuard(jwt, config);
    const token = svc.issueAdminToken();
    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).resolves.toBe(true);
  });

  it('loginWithBootstrap con seed correcto emite token admin', () => {
    const svc = new AdminAuthService(jwt, makeConfig(), credenciales);
    const token = svc.loginWithBootstrap(BOOTSTRAP);
    expect(jwt.verify<{ role: string }>(token, { secret: SECRET }).role).toBe(
      'admin',
    );
  });

  it('loginWithBootstrap con seed incorrecto → 401', () => {
    const svc = new AdminAuthService(jwt, makeConfig(), credenciales);
    expect(() => svc.loginWithBootstrap('wrong')).toThrow(UnauthorizedException);
  });
});
