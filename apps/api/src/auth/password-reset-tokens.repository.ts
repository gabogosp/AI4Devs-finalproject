import { Injectable } from '@nestjs/common';
import { PasswordResetToken } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';

export interface IssueResetTokenData {
  customerId: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Único punto de ORM para `password_reset_tokens` (§5).
 *
 * Ninguna consulta acepta el token en claro: el llamador hashea y busca por
 * hash. Si el claro llegara hasta acá terminaría en los logs de consultas lentas
 * de Postgres el día que alguien active `log_min_duration_statement`.
 */
@Injectable()
export class PasswordResetTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  issue(data: IssueResetTokenData): Promise<PasswordResetToken> {
    return this.prisma.passwordResetToken.create({
      data: {
        customer_id: data.customerId,
        token_hash: data.tokenHash,
        expires_at: data.expiresAt,
      },
    });
  }

  /**
   * Devuelve el token **sólo si sirve**: ni usado ni vencido.
   *
   * Acá sí se filtra por estado — al revés que en `refresh_tokens`. La diferencia
   * es intencional: el reset no tiene detección de reuso que informar, así que
   * "usado", "vencido" e "inexistente" colapsan en el mismo `null` y de ahí sale
   * un único error (AC-7). Distinguirlos le diría a quien tenga el token si
   * alguien más ya lo consumió.
   *
   * La comparación de `expires_at` la hace Postgres contra su propio reloj, no
   * Node contra el suyo: si los relojes divergen, el que manda es el que tiene
   * la fila.
   */
  findUsableByHash(tokenHash: string): Promise<PasswordResetToken | null> {
    return this.prisma.passwordResetToken.findFirst({
      where: {
        token_hash: tokenHash,
        used_at: null,
        expires_at: { gt: new Date() },
      },
    });
  }

  /** Consumo de un solo uso. */
  async markUsed(id: string): Promise<void> {
    await this.prisma.passwordResetToken.update({
      where: { id },
      data: { used_at: new Date() },
    });
  }

  /**
   * Cuántos reset pidió este cliente desde `since` — alimenta el límite por
   * cuenta de `PASSWORD_RESET_MAX_PER_HOUR` (T6.1).
   *
   * Es un límite distinto del rate-limit por IP: sin él, alguien podría inundar
   * de emails el buzón de una víctima rotando IPs, y el costo lo paga la
   * reputación de envío del dominio.
   */
  countIssuedSince(customerId: string, since: Date): Promise<number> {
    return this.prisma.passwordResetToken.count({
      where: { customer_id: customerId, created_at: { gte: since } },
    });
  }

  /**
   * Borra los reset pendientes del cliente. Se llama al completar un reset: si
   * había varios emitidos, el que se usó consume todos los demás. Un enlace
   * viejo que siguiera vivo tras un cambio de contraseña es exactamente el
   * camino por el que un atacante que pidió un reset antes recupera el acceso.
   */
  async deleteAllForCustomer(customerId: string): Promise<number> {
    const { count } = await this.prisma.passwordResetToken.deleteMany({
      where: { customer_id: customerId },
    });
    return count;
  }
}
