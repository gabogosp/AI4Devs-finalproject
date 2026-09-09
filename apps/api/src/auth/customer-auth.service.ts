import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
import { AuthEventsService } from '../observability/auth-events.service';
import { WELCOME_MAILER, WelcomeMailer } from './mail/welcome-mailer';

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
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    private readonly customers: CustomersRepository,
    private readonly hasher: PasswordHasher,
    private readonly credentials: CredentialsService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
    // Opcional: `customer-auth.service.spec.ts` construye la clase con 5
    // argumentos, sin DI — no debe romperse. Mismo criterio que
    // `ConfirmOrderService`. Nest siempre lo provee en producción
    // (`auth.module.ts`).
    @Inject(WELCOME_MAILER) @Optional() private readonly welcomeMailer?: WelcomeMailer,
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

    this.events.emit('auth.registered', customer.id);
    // Best-effort, fuera del camino crítico del alta: un fallo del proveedor
    // de email no puede convertir un 201 en 500 (AC-1, "alta + sesión en la
    // misma operación"). El puerto ya no propaga (`WelcomeMailer.send`), pero
    // el `catch` es defensa en profundidad si algún adapter futuro lo hiciera.
    this.welcomeMailer
      ?.send({ to: customer.email, name: customer.name, customerId: customer.id })
      .catch((error) =>
        this.logger.error(
          `welcome.trigger_failed customer_id=${customer.id}: ${(error as Error).message}`,
        ),
      );
    return { customer, session };
  }

  /** Login (AC-2): delega la verificación y el lockout, y abre sesión nueva. */
  async login(email: string, password: string): Promise<AuthResult> {
    const customer = await this.credentials.verify(email, password);
    const session = await this.sessions.issue({
      id: customer.id,
      role: customer.role,
    });
    this.events.emit('auth.login_succeeded', customer.id);
    return { customer, session };
  }

  /** El rol que fija el servidor (ver `ROL_CLIENTE` en el repositorio). */
  static get rolPorDefecto(): string {
    return ROL_CLIENTE;
  }
}
