import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminGuard } from './admin.guard';

const SECRET = 'test-secret';

function contextWith(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authorization ? { authorization } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard (admin-guard)', () => {
  const jwt = new JwtService({});
  const config = {
    get: () => SECRET,
  } as unknown as ConfigService;
  const guard = new AdminGuard(jwt, config);

  it('sin token → 401', async () => {
    await expect(guard.canActivate(contextWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token con firma inválida → 401', async () => {
    await expect(
      guard.canActivate(contextWith('Bearer not-a-jwt')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rol != admin → 403', async () => {
    const token = jwt.sign({ role: 'customer' }, { secret: SECRET });
    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rol = admin → pasa', async () => {
    const token = jwt.sign({ role: 'admin' }, { secret: SECRET });
    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).resolves.toBe(true);
  });
});
