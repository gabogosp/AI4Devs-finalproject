import { Injectable, Logger } from '@nestjs/common';
import { WelcomeEmail, WelcomeMailer } from './welcome-mailer';

/**
 * Adapter de **desarrollo y test** del puerto de bienvenida — no manda
 * ningún email, escribe en el log. Fallback que `welcome-mailer.provider.ts`
 * resuelve cuando `RESEND_API_KEY` no está presente (local/CI sin
 * credenciales); en producción el binding real es `ResendWelcomeMailer`.
 *
 * `name`/`to` NUNCA se loguean — el `customer_id` alcanza para correlacionar.
 */
@Injectable()
export class LoggingWelcomeMailer implements WelcomeMailer {
  private readonly logger = new Logger(LoggingWelcomeMailer.name);

  async send(input: WelcomeEmail): Promise<void> {
    this.logger.log(`welcome.dispatched customer_id=${input.customerId}`);
  }
}
