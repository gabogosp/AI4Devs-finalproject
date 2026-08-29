import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CredentialsService } from './credentials.service';
import { InvalidCredentialsError } from '../common/errors/auth-errors';
import { SafeCustomer } from './customers.repository';

/** Rol que abre `/v1/admin/*`. Contrato de ADR-0009, consumido por `AdminGuard`. */
export const ROL_ADMIN = 'admin';

/**
 * Emisión del token admin (seam, ADR-0009).
 *
 * US-014 cumple lo que el ADR anticipó: reemplaza el **lado de emisión**
 * agregando login por credenciales, y deja intactos el contrato `role=admin`, la
 * ruta, el transporte y la forma de la respuesta. `AdminGuard` no se toca — hay
 * un `git diff --exit-code` sobre ese archivo en el Verify de T8.1 que lo prueba
 * contra la base de la rama, no contra el working tree.
 *
 * El bootstrap token sigue existiendo detrás de `ADMIN_AUTH_ENABLED` como salida
 * de emergencia: si la cuenta admin queda inaccesible (contraseña perdida, fila
 * borrada), es el único camino de vuelta. El procedimiento de corte está en el
 * README.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly credentials: CredentialsService,
  ) {}

  /** Firma un JWT con `role=admin` (contrato consumido por AdminGuard). */
  issueAdminToken(sub = 'admin'): string {
    return this.jwt.sign(
      { role: ROL_ADMIN, sub },
      { secret: this.config.getOrThrow<string>('JWT_SECRET'), expiresIn: '1h' },
    );
  }

  /**
   * Login por credenciales contra la tabla `customers` con `role='admin'`.
   *
   * Reusa `CredentialsService`, así que el admin hereda el lockout con backoff y
   * la indistinguibilidad de errores sin código duplicado. La comprobación del
   * rol lanza **el mismo** `InvalidCredentialsError`: si dijera "esta cuenta no
   * es admin" estaría confirmando que la cuenta existe, y el panel es un blanco
   * más valioso que el storefront.
   */
  async loginWithCredentials(
    email: string,
    password: string,
  ): Promise<{ token: string; customer: SafeCustomer }> {
    const customer = await this.credentials.verify(email, password);

    if (customer.role !== ROL_ADMIN) {
      throw new InvalidCredentialsError();
    }

    return { token: this.issueAdminToken(customer.id), customer };
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
