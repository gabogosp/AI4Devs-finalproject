import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * Emisión acotada del token admin (seam, ADR-0009). Detrás de config
 * (`ADMIN_AUTH_ENABLED` + `ADMIN_BOOTSTRAP_TOKEN`). Sin registro de clientes,
 * refresh rotado ni 2FA — eso lo entrega US-014, que reemplaza esta emisión
 * preservando el contrato `role=admin`.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Firma un JWT con `role=admin` (contrato consumido por AdminGuard). */
  issueAdminToken(): string {
    return this.jwt.sign(
      { role: 'admin', sub: 'admin' },
      { secret: this.config.getOrThrow<string>('JWT_SECRET'), expiresIn: '1h' },
    );
  }

  /** Intercambia el bootstrap token (seed de config) por un JWT admin. */
  loginWithBootstrap(bootstrapToken: string): string {
    if (this.config.get<string>('ADMIN_AUTH_ENABLED') === 'false') {
      throw new ServiceUnavailableException('Auth admin deshabilitada');
    }
    const expected = this.config.get<string>('ADMIN_BOOTSTRAP_TOKEN');
    if (!expected || bootstrapToken !== expected) {
      throw new UnauthorizedException('Bootstrap token inválido');
    }
    return this.issueAdminToken();
  }
}
