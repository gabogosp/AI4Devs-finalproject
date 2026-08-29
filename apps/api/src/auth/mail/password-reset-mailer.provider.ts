import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  PASSWORD_RESET_MAILER,
  PasswordResetMailer,
} from './password-reset-mailer';
import { LoggingPasswordResetMailer } from './logging-password-reset-mailer';
import { ResendPasswordResetMailer } from './resend-password-reset-mailer';

/**
 * Selección del adapter por entorno (T7.2).
 *
 * Con `RESEND_API_KEY` presente resuelve al adapter real; sin ella, al de log —
 * así local y CI corren sin credenciales.
 *
 * La salvaguarda contra la degradación silenciosa vive en `envSchema`
 * (`superRefine`): en producción, faltar la clave **hace fallar el arranque**.
 * Acá no hace falta repetir el chequeo, pero sí dejar el rastro: si el proceso
 * llegó a esta línea sin clave, es porque no está en producción.
 */
export const passwordResetMailerProvider: Provider = {
  provide: PASSWORD_RESET_MAILER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): PasswordResetMailer => {
    const apiKey = config.get<string>('RESEND_API_KEY');
    const logger = new Logger('PasswordResetMailerProvider');

    if (!apiKey) {
      logger.warn(
        'RESEND_API_KEY ausente: se usa el adapter de log. Los emails de recuperación NO se envían.',
      );
      return new LoggingPasswordResetMailer();
    }

    return new ResendPasswordResetMailer(new Resend(apiKey), config);
  },
};
