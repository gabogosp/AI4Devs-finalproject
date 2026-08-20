import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvalidCredentialsError } from '../common/errors/auth-errors';
import { CustomersRepository, SafeCustomer } from './customers.repository';
import { PasswordHasher } from './password/password-hasher';

/** Reloj inyectable — el backoff se prueba sin esperar 60 minutos reales. */
export interface Clock {
  now(): Date;
}

export const SYSTEM_CLOCK: Clock = { now: () => new Date() };

/**
 * Verificación de credenciales con bloqueo temporal — `security-standards.md`
 * §7.3 y AC-2 / AC-5 / AC-10.
 *
 * Todo el diseño de esta clase gira alrededor de una sola idea: **desde afuera,
 * los tres modos de fallo tienen que ser idénticos**. Email que no existe,
 * contraseña incorrecta y cuenta bloqueada devuelven el mismo error, con el
 * mismo `detail`, y en el mismo orden de tiempo. Cualquier diferencia observable
 * convierte el login en un oráculo: quien pruebe direcciones aprende cuáles
 * están registradas, y ese listado es la materia prima del phishing dirigido.
 *
 * De ahí salen las dos decisiones que parecen raras leyendo el código:
 * el `verifyDummy` cuando no hay usuario, y que el bloqueo se compruebe
 * **después** de verificar la contraseña.
 */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly hasher: PasswordHasher,
    private readonly config: ConfigService,
    private readonly clock: Clock = SYSTEM_CLOCK,
  ) {}

  private get maxFailures(): number {
    return this.config.get<number>('AUTH_LOGIN_MAX_FAILURES') ?? 5;
  }

  private get baseMin(): number {
    return this.config.get<number>('AUTH_LOCKOUT_BASE_MIN') ?? 15;
  }

  private get maxMin(): number {
    return this.config.get<number>('AUTH_LOCKOUT_MAX_MIN') ?? 60;
  }

  /**
   * Devuelve el cliente si las credenciales son válidas y la cuenta no está
   * bloqueada. En cualquier otro caso lanza `InvalidCredentialsError`.
   */
  async verify(email: string, plainPassword: string): Promise<SafeCustomer> {
    const cliente = await this.customers.findActiveByEmailWithHash(email);

    if (!cliente) {
      // Sin esta línea, "email inexistente" volvería en microsegundos mientras
      // "contraseña incorrecta" tarda ~250 ms, y esa diferencia enumera cuentas
      // aunque el cuerpo de la respuesta sea idéntico.
      await this.hasher.verifyDummy(plainPassword);
      throw new InvalidCredentialsError();
    }

    const passwordCorrecta = await this.hasher.verify(
      plainPassword,
      cliente.password_hash,
    );

    // El bloqueo se evalúa DESPUÉS de verificar, aunque cortar antes sería más
    // barato. Si se cortara antes, una cuenta bloqueada respondería sin pagar el
    // bcrypt y su tiempo de respuesta la delataría — un atacante sabría que
    // acertó una cuenta real sólo por haberla bloqueado. Se paga el hash igual.
    const bloqueada =
      cliente.locked_until !== null &&
      cliente.locked_until.getTime() > this.clock.now().getTime();

    if (bloqueada || !passwordCorrecta) {
      if (!passwordCorrecta && !bloqueada) {
        await this.registrarFallo(cliente.id, cliente.lockout_count);
      }
      throw new InvalidCredentialsError();
    }

    await this.customers.resetLoginFailures(cliente.id);

    const { password_hash: _hash, ...safe } = cliente;
    return safe;
  }

  /**
   * Suma el fallo y, al llegar al umbral, bloquea con backoff exponencial.
   *
   * `min(BASE * 2^(n-1), MAX)` — 15, 30, 60, 60… El tope existe porque §7.3
   * prohíbe el bloqueo permanente: si el castigo creciera sin límite, un atacante
   * podría dejar fuera de su cuenta a cualquier usuario indefinidamente sólo
   * fallando el login a propósito. El bloqueo protege la contraseña, no puede
   * convertirse en una denegación de servicio contra el dueño legítimo.
   */
  private async registrarFallo(
    customerId: string,
    lockoutCountActual: number,
  ): Promise<void> {
    const fallos = await this.customers.registerFailedLogin(customerId);
    if (fallos < this.maxFailures) return;

    const nuevoCiclo = lockoutCountActual + 1;
    const minutos = Math.min(
      this.baseMin * 2 ** (nuevoCiclo - 1),
      this.maxMin,
    );
    const hasta = new Date(this.clock.now().getTime() + minutos * 60_000);
    await this.customers.lockUntil(customerId, hasta, nuevoCiclo);
  }
}
