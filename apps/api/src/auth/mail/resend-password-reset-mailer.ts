import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  PasswordResetEmail,
  PasswordResetMailer,
} from './password-reset-mailer';

/**
 * Adapter de producción del puerto de reset (T7.2).
 *
 * Entró en US-014 por decisión del PO (2026-08-19): la planificación original lo
 * dejaba en US-011, y US-011 depende del loop de compra entero. AC-4 habría
 * quedado inalcanzable en producción durante varios ciclos — un flujo de
 * recuperación que ningún cliente puede usar.
 *
 * Que el servicio no haya cambiado una línea para incorporarlo es la evidencia
 * de que el puerto estaba bien diseñado.
 */
@Injectable()
export class ResendPasswordResetMailer implements PasswordResetMailer {
  private readonly logger = new Logger(ResendPasswordResetMailer.name);

  constructor(
    private readonly resend: Resend,
    private readonly config: ConfigService,
  ) {}

  async send(input: PasswordResetEmail): Promise<void> {
    const from = this.config.getOrThrow<string>('PASSWORD_RESET_FROM');
    const base = this.config.getOrThrow<string>('PASSWORD_RESET_URL_BASE');
    const enlace = `${base.replace(/\/$/, '')}/recuperar/confirmar?token=${encodeURIComponent(input.rawToken)}`;

    try {
      const { error } = await this.resend.emails.send({
        from,
        to: input.to,
        subject: 'Recuperá tu contraseña — DSM Ferretería',
        text: this.cuerpoTexto(enlace, input.ttlMinutes),
        html: this.cuerpoHtml(enlace, input.ttlMinutes),
      });

      if (error) {
        // El SDK de Resend devuelve el error en el resultado en vez de lanzarlo.
        // Sin este chequeo, un rechazo del proveedor pasaría por envío exitoso y
        // el fallo sería invisible hasta que un cliente se queje.
        throw new Error(`${error.name}: ${error.message}`);
      }

      this.logger.log(
        `password_reset.dispatched customer_id=${input.customerId} provider=resend`,
      );
    } catch (error) {
      // Contrato del puerto: no propagar. Si un 503 de Resend cambiara el tiempo
      // o el código de la respuesta, delataría qué direcciones están
      // registradas y se perdería AC-11.
      //
      // El log lleva `customer_id`, nunca el email ni el token: quien lea los
      // logs no debe poder tomar la cuenta de nadie.
      this.logger.error(
        `password_reset.dispatch_failed customer_id=${input.customerId} provider=resend`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private cuerpoTexto(enlace: string, ttlMin: number): string {
    return [
      'Recibimos un pedido para restablecer la contraseña de tu cuenta en DSM Ferretería.',
      '',
      `Entrá acá para elegir una nueva: ${enlace}`,
      '',
      `El enlace vence en ${ttlMin} minutos y se puede usar una sola vez.`,
      '',
      'Si no pediste esto, podés ignorar este mensaje: tu contraseña no cambió.',
    ].join('\n');
  }

  private cuerpoHtml(enlace: string, ttlMin: number): string {
    return [
      '<p>Recibimos un pedido para restablecer la contraseña de tu cuenta en <strong>DSM Ferretería</strong>.</p>',
      `<p><a href="${enlace}">Elegí una contraseña nueva</a></p>`,
      `<p>El enlace vence en ${ttlMin} minutos y se puede usar una sola vez.</p>`,
      '<p>Si no pediste esto, podés ignorar este mensaje: tu contraseña no cambió.</p>',
    ].join('\n');
  }
}
