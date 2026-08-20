import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidationError } from '../common/errors/domain-errors';
import { InvalidResetTokenError } from '../common/errors/auth-errors';
import { CustomersRepository } from './customers.repository';
import { PasswordResetTokensRepository } from './password-reset-tokens.repository';
import { PasswordHasher } from './password/password-hasher';
import { validatePassword } from './password/password-policy';
import { SessionService } from './session.service';
import { hashToken, newToken } from './tokens/opaque-token';
import {
  PASSWORD_RESET_MAILER,
  PasswordResetMailer,
} from './mail/password-reset-mailer';

/**
 * Recuperación de contraseña — AC-4, AC-7, AC-11 y `security-standards.md` §3.7.
 *
 * La forma de `request` está dictada por AC-11: la respuesta tiene que ser
 * **idéntica** exista o no la cuenta. Por eso el método devuelve `void` y no
 * lanza nunca — ni si el email no existe, ni si se pasó del límite por hora, ni
 * si el proveedor de email falla. Cualquier salida distinta sería un verificador
 * de qué direcciones están registradas.
 *
 * `confirm` hace lo contrario: es tajante. Un token que no sirve da error, y los
 * tres motivos (inexistente, vencido, ya usado) dan **el mismo** error (AC-7).
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly customers: CustomersRepository,
    private readonly tokens: PasswordResetTokensRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
    @Inject(PASSWORD_RESET_MAILER)
    private readonly mailer: PasswordResetMailer,
  ) {}

  private get ttlMin(): number {
    return this.config.get<number>('PASSWORD_RESET_TTL_MIN') ?? 60;
  }

  private get maxPorHora(): number {
    return this.config.get<number>('PASSWORD_RESET_MAX_PER_HOUR') ?? 3;
  }

  /**
   * Pide un reset. **Nunca lanza y nunca informa el resultado** (AC-11).
   *
   * Los tres caminos posibles — cuenta inexistente, límite superado, envío
   * exitoso — terminan igual desde afuera. El único rastro de la diferencia está
   * en los logs del servidor, que es donde corresponde.
   */
  async request(email: string): Promise<void> {
    const cliente = await this.customers.findActiveByEmail(email);

    if (!cliente) {
      // Deliberadamente silencioso. Un log de nivel warn acá tampoco cambia la
      // respuesta, pero sí ayuda a detectar un barrido de direcciones.
      this.logger.log('password_reset.requested_unknown_account');
      return;
    }

    const desde = new Date(Date.now() - 3_600_000);
    const emitidos = await this.tokens.countIssuedSince(cliente.id, desde);
    if (emitidos >= this.maxPorHora) {
      // Límite por CUENTA, distinto del rate-limit por IP: sin él, alguien podría
      // inundar el buzón de una víctima rotando IPs, y el costo lo paga la
      // reputación de envío del dominio.
      this.logger.warn(
        `password_reset.rate_limited customer_id=${cliente.id} issued=${emitidos}`,
      );
      return;
    }

    const raw = newToken();
    await this.tokens.issue({
      customerId: cliente.id,
      tokenHash: hashToken(raw), // sólo el hash toca la base
      expiresAt: new Date(Date.now() + this.ttlMin * 60_000),
    });

    try {
      await this.mailer.send({
        to: cliente.email,
        customerId: cliente.id,
        rawToken: raw,
        ttlMinutes: this.ttlMin,
      });
    } catch (error) {
      // El puerto se compromete a no propagar, pero un adapter con un bug podría
      // hacerlo igual. Se atrapa acá también: si un fallo del proveedor cambiara
      // el tiempo o el código de respuesta, delataría qué direcciones existen.
      this.logger.error(
        `password_reset.dispatch_failed customer_id=${cliente.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Completa el reset (AC-4). Cambia la contraseña y, con ella, **cierra todas
   * las sesiones de la cuenta** (§3.7).
   *
   * Ese barrido es el punto del ejercicio: si alguien recupera su contraseña es
   * porque sospecha que perdió el control de la cuenta. Dejar vivas las sesiones
   * del atacante haría que el reset no sirviera para nada.
   */
  async confirm(rawToken: string, nuevaPassword: string): Promise<void> {
    const violaciones = validatePassword(nuevaPassword);
    if (violaciones.length > 0) {
      throw new ValidationError(
        'La contraseña no cumple la política',
        violaciones.map((v) => ({ field: 'password', message: v })),
      );
    }

    const fila = await this.tokens.findUsableByHash(hashToken(rawToken));
    if (!fila) {
      // Inexistente, vencido o ya usado: el repositorio ya los colapsó en null y
      // acá salen como el mismo error (AC-7).
      throw new InvalidResetTokenError();
    }

    const passwordHash = await this.hasher.hash(nuevaPassword);

    // `updatePassword` sella `password_changed_at` y levanta el bloqueo: quien
    // acaba de recuperar su contraseña debe poder entrar en el acto.
    await this.customers.updatePassword(fila.customer_id, passwordHash);
    await this.tokens.markUsed(fila.id);
    // Los demás tokens pendientes se consumen con éste. Un enlace viejo que
    // sobreviviera al cambio es el camino por el que un atacante que pidió un
    // reset antes recupera el acceso.
    await this.tokens.deleteAllForCustomer(fila.customer_id);
    await this.sessions.revokeAllForCustomer(fila.customer_id);

    this.logger.log(
      `password_reset.completed customer_id=${fila.customer_id}`,
    );
  }
}
