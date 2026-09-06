import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { NOTIFICATION_PORT, NotificationPort } from './notification.port';
import { LoggingNotificationAdapter } from './logging-notification.adapter';
import { ResendNotificationAdapter } from './resend-notification.adapter';
import { NotificationEventsService } from '../../observability/notification-events.service';

/**
 * Selección del adapter por entorno (US-011 T7.1) — mismo patrón que
 * `passwordResetMailerProvider`.
 *
 * Con `RESEND_API_KEY` presente resuelve al adapter real; sin ella, al de
 * log — así local y CI corren sin credenciales.
 *
 * La salvaguarda contra la degradación silenciosa vive en `envSchema`
 * (`superRefine`): en producción, faltar la clave (o `ORDER_NOTIFICATIONS_FROM`/
 * `OWNER_NOTIFICATION_EMAIL`) **hace fallar el arranque**. Acá no hace falta
 * repetir el chequeo, pero sí dejar el rastro: si el proceso llegó a esta
 * línea sin clave, es porque no está en producción.
 */
export const notificationPortProvider: Provider = {
  provide: NOTIFICATION_PORT,
  inject: [ConfigService, NotificationEventsService],
  useFactory: (config: ConfigService, events: NotificationEventsService): NotificationPort => {
    const apiKey = config.get<string>('RESEND_API_KEY');
    const logger = new Logger('NotificationPortProvider');

    if (!apiKey) {
      logger.warn(
        'RESEND_API_KEY ausente: se usa el adapter de log. Los avisos de orden NO se envían.',
      );
      return new LoggingNotificationAdapter();
    }

    return new ResendNotificationAdapter(new Resend(apiKey), config, events);
  },
};
