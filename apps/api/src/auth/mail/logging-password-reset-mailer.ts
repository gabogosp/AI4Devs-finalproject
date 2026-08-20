import { Injectable, Logger } from '@nestjs/common';
import {
  PasswordResetEmail,
  PasswordResetMailer,
} from './password-reset-mailer';

/**
 * Adapter de **desarrollo y test** del puerto de reset.
 *
 * No manda ningún email: escribe en el log. Su razón de ser es que local y CI
 * puedan ejercer AC-4 de punta a punta sin credenciales de Resend ni un buzón
 * real — el e2e lee el token del log y lo usa para confirmar el cambio.
 *
 * Es explícitamente **no apto para producción**: allá se usa el adapter de
 * Resend (T7.2), y el arranque falla si falta su clave, justamente para que
 * nadie termine en producción con éste creyendo que los emails salen.
 *
 * El token en claro se loguea sólo fuera de producción. La guarda es defensa en
 * profundidad: aunque este adapter no debería estar activo en producción, si por
 * un error de configuración lo estuviera, no va a dejar tokens de recuperación
 * en un archivo de log que suele tener menos controles de acceso que la base.
 */
@Injectable()
export class LoggingPasswordResetMailer implements PasswordResetMailer {
  private readonly logger = new Logger(LoggingPasswordResetMailer.name);

  async send(input: PasswordResetEmail): Promise<void> {
    const esProduccion = process.env.NODE_ENV === 'production';

    // El email del destinatario NO se loguea nunca: el `customer_id` alcanza
    // para correlacionar y no es PII (E2E §18).
    this.logger.log(
      `password_reset.dispatched customer_id=${input.customerId} ttl_min=${input.ttlMinutes}`,
    );

    if (!esProduccion) {
      this.logger.debug(
        `password_reset.token customer_id=${input.customerId} token=${input.rawToken}`,
      );
    }
  }
}
