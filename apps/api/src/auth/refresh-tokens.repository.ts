import { Injectable } from '@nestjs/common';
import { RefreshToken } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';

export interface IssueRefreshTokenData {
  customerId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

/**
 * Único punto de ORM para `refresh_tokens` (§5). Es la tabla que hace posible
 * ADR-0011: rotación, detección de reuso y revocación inmediata.
 *
 * Nada acá acepta ni devuelve el token en claro — sólo su hash. El claro existe
 * únicamente en la cookie del cliente y en la variable local que lo generó.
 */
@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  issue(data: IssueRefreshTokenData): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        customer_id: data.customerId,
        token_hash: data.tokenHash,
        family_id: data.familyId,
        expires_at: data.expiresAt,
      },
    });
  }

  /**
   * Busca por hash **sin** filtrar por estado, a propósito.
   *
   * Es tentador devolver sólo los vigentes, pero entonces un token ya rotado
   * daría `null` y sería indistinguible de uno inexistente — y ahí se pierde la
   * detección de reuso, que es el corazón de ADR-0011. El service necesita ver
   * `rotated_at` para saber que está frente a una réplica y revocar la familia.
   */
  findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { token_hash: tokenHash },
    });
  }

  /** Marca el token como consumido por una rotación. Es de un solo uso. */
  async markRotated(id: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { rotated_at: new Date() },
    });
  }

  /**
   * Revoca la familia entera en **una** sentencia. La atomicidad importa: si se
   * revocaran de a una, el atacante tendría una ventana para usar las que
   * quedaran mientras corre el barrido.
   *
   * Devuelve cuántas filas quedaron revocadas — el service lo emite como métrica
   * de reuso detectado (T9.1).
   */
  async revokeFamily(familyId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { family_id: familyId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    return count;
  }

  /** Todas las sesiones del cliente. Lo usa el reset de contraseña (§3.7). */
  async revokeAllForCustomer(customerId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { customer_id: customerId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    return count;
  }

  /**
   * Limpieza oportunista, acotada a **este** cliente y a filas ya vencidas.
   *
   * La purga programada de toda la tabla es `Deferred` (necesita BullMQ y Redis
   * no está provisionado, ADR-0004). Esto no la reemplaza: es lo que evita que
   * un cliente que refresca durante meses acumule cientos de filas muertas. El
   * alcance por cliente es deliberado — un `deleteMany` global en el camino del
   * login sería un barrido de tabla en la ruta más caliente del sistema.
   */
  async purgeExpiredForCustomer(customerId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { customer_id: customerId, expires_at: { lt: new Date() } },
    });
    return count;
  }
}
