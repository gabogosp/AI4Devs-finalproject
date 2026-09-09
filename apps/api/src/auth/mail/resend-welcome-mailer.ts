import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { escapeHtml } from '../../orders/ports/notification-templates';
import { WelcomeEmail, WelcomeMailer } from './welcome-mailer';

/**
 * Adapter de producción del puerto de bienvenida. Mismo contrato que
 * `ResendPasswordResetMailer`: nunca propaga, timeout acotado por intento,
 * sin PII en logs. Sin reintento a propósito — mismo criterio que el reset
 * de password: un email de bienvenida perdido no bloquea ningún flujo (la
 * cuenta ya quedó creada y con sesión activa), así que no amerita la
 * complejidad de backoff que sí se justifica donde hay dinero en juego
 * (`ResendNotificationAdapter`, pagos).
 *
 * Reusa `ORDER_NOTIFICATIONS_FROM`/`RESEND_TIMEOUT_MS` — genéricos, no
 * específicos de ningún flujo (mismo criterio documentado en
 * `env.validation.ts` para `NotificationPort`).
 */
@Injectable()
export class ResendWelcomeMailer implements WelcomeMailer {
  private readonly logger = new Logger(ResendWelcomeMailer.name);

  constructor(
    private readonly resend: Resend,
    private readonly config: ConfigService,
  ) {}

  async send(input: WelcomeEmail): Promise<void> {
    const from = this.config.getOrThrow<string>('ORDER_NOTIFICATIONS_FROM');

    try {
      const { error } = await this.conTimeout(
        this.resend.emails.send({
          from,
          to: input.to,
          subject: '¡Bienvenido a DSM Ferretería!',
          text: this.cuerpoTexto(input.name),
          html: this.cuerpoHtml(input.name),
        }),
      );

      if (error) {
        throw new Error(`${error.name}: ${error.message}`);
      }

      this.logger.log(`welcome.dispatched customer_id=${input.customerId} provider=resend`);
    } catch (error) {
      this.logger.error(
        `welcome.dispatch_failed customer_id=${input.customerId} provider=resend`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Duplicado a propósito de `ResendPasswordResetMailer.conTimeout` — ver ese archivo. */
  private async conTimeout<T>(promesa: Promise<T>): Promise<T> {
    const ms = this.config.get<number>('RESEND_TIMEOUT_MS', 5_000);
    let temporizador: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promesa,
        new Promise<never>((_, reject) => {
          temporizador = setTimeout(
            () => reject(new Error(`resend_timeout_after_${ms}ms`)),
            ms,
          );
        }),
      ]);
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  private cuerpoTexto(name: string): string {
    return [
      `Hola ${name},`,
      '',
      '¡Gracias por registrarte en DSM Ferretería!',
      '',
      'Ya podés explorar el catálogo y armar tu pedido — coordinamos el pago y el',
      'retiro/envío por WhatsApp una vez que hagas tu primera compra.',
      '',
      'Cualquier duda, escribinos.',
    ].join('\n');
  }

  private cuerpoHtml(name: string): string {
    return [
      `<p>Hola ${escapeHtml(name)},</p>`,
      '<p>¡Gracias por registrarte en <strong>DSM Ferretería</strong>!</p>',
      '<p>Ya podés explorar el catálogo y armar tu pedido — coordinamos el pago y el retiro/envío por WhatsApp una vez que hagas tu primera compra.</p>',
      '<p>Cualquier duda, escribinos.</p>',
    ].join('\n');
  }
}
