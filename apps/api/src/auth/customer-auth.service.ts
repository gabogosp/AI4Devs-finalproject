import { Injectable } from '@nestjs/common';
import { ValidationError } from '../common/errors/domain-errors';
import { CredentialsService } from './credentials.service';
import {
  CustomersRepository,
  ROL_CLIENTE,
  SafeCustomer,
} from './customers.repository';
import { PasswordHasher } from './password/password-hasher';
import { validatePassword } from './password/password-policy';
import { IssuedSession, SessionService } from './session.service';

export interface RegisterInput {
  email: string;
  name: string;
  phone?: string | null;
  password: string;
}

export interface AuthResult {
  customer: SafeCustomer;
  session: IssuedSession;
}

/** Casos de uso de registro y login (AC-1, AC-2, AC-6). */
@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly hasher: PasswordHasher,
    private readonly credentials: CredentialsService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Alta + sesión activa en la misma operación (AC-1): no hay paso de
   * verificación de email intermedio. Es una decisión de producto — una
   * ferretería no puede permitirse perder la mitad de las altas en un email de
   * confirmación que termina en spam.
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    // La política se evalúa ANTES de tocar la base: una contraseña inválida no
    // debe costar una consulta, y así el 422 no depende de si el email existe.
    const violaciones = validatePassword(input.password);
    if (violaciones.length > 0) {
      throw new ValidationError(
        'La contraseña no cumple la política',
        violaciones.map((v) => ({ field: 'password', message: v })),
      );
    }

    const passwordHash = await this.hasher.hash(input.password);

    // `create` traduce el UNIQUE violado a `RegistrationFailedError` (409). Si
    // el email ya existe, no se crea fila ni se emite sesión (AC-6): la
    // excepción sale de acá y el `issue` de abajo nunca corre.
    const customer = await this.customers.create({
      email: input.email,
      name: input.name,
      phone: input.phone,
      passwordHash,
    });

    const session = await this.sessions.issue({
      id: customer.id,
      role: customer.role,
    });

    return { customer, session };
  }

  /** Login (AC-2): delega la verificación y el lockout, y abre sesión nueva. */
  async login(email: string, password: string): Promise<AuthResult> {
    const customer = await this.credentials.verify(email, password);
    const session = await this.sessions.issue({
      id: customer.id,
      role: customer.role,
    });
    return { customer, session };
  }

  /** El rol que fija el servidor (ver `ROL_CLIENTE` en el repositorio). */
  static get rolPorDefecto(): string {
    return ROL_CLIENTE;
  }
}
