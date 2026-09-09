import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { WELCOME_MAILER, WelcomeMailer } from './welcome-mailer';
import { LoggingWelcomeMailer } from './logging-welcome-mailer';
import { ResendWelcomeMailer } from './resend-welcome-mailer';

/**
 * Selección del adapter por entorno — mismo patrón que
 * `passwordResetMailerProvider`/`notificationPortProvider`.
 *
 * Con `RESEND_API_KEY` presente resuelve al adapter real; sin ella, al de
 * log — así local y CI corren sin credenciales. No hay salvaguarda de
 * arranque en `env.validation.ts` para producción (a diferencia de
 * `PASSWORD_RESET_FROM`/`ORDER_NOTIFICATIONS_FROM`): el email de bienvenida
 * es best-effort, no crítico — degradar al adapter de log en un deploy mal
 * configurado no bloquea ningún flujo de negocio, sólo pierde un email
 * informativo.
 */
export const welcomeMailerProvider: Provider = {
  provide: WELCOME_MAILER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): WelcomeMailer => {
    const apiKey = config.get<string>('RESEND_API_KEY');
    const logger = new Logger('WelcomeMailerProvider');

    if (!apiKey) {
      logger.warn(
        'RESEND_API_KEY ausente: se usa el adapter de log. El email de bienvenida NO se envía.',
      );
      return new LoggingWelcomeMailer();
    }

    return new ResendWelcomeMailer(new Resend(apiKey), config);
  },
};
