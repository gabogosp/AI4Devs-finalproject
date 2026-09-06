import { Injectable } from '@nestjs/common';
import { CustomersRepository } from '../auth/customers.repository';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { PasswordResetTokensRepository } from '../auth/password-reset-tokens.repository';
import { CartsRepository } from '../cart/carts.repository';
import { OrdersRepository } from '../checkout/orders.repository';
import { OrderHistorySummaryDto } from '../orders/dto/order-history.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AccountEventsService } from '../observability/account-events.service';
import { AccountHasActiveOrdersError } from './account-errors';

/**
 * Orquestación del borrado de cuenta (US-020, `design.md` §Approach —
 * "AccountDeletionService"). Un único `prisma.$transaction` con 6 pasos, mismo
 * idioma multi-repositorio con `tx` explícito que
 * `payments/cancel-order.service.ts`.
 *
 * **Orden de los pasos, y por qué:**
 * 1. `listBlockingForCustomer` es la PRIMERA lectura dentro de la transacción
 *    (AC-4/AC-9): el chequeo de bloqueo y todas las escrituras comparten la
 *    misma serialización de Postgres, así que la ventana de carrera es la
 *    duración de la transacción, no el tiempo entre mostrar el aviso y que el
 *    cliente confirme. Si hay al menos una orden bloqueante, lanza dentro de
 *    la transacción — Postgres hace rollback automático, cero escrituras.
 * 2. `customers.anonymize` — su `null` es la guarda de idempotencia (AC-15):
 *    una cuenta ya borrada no vuelve a escribir nada, y el resto de los pasos
 *    ni se ejecuta.
 * 3-6. Revocar sesiones, borrar resets pendientes, desvincular carritos,
 *    anonimizar órdenes — en ese orden, todos dentro de la misma transacción.
 *
 * El evento `account.deleted` se emite DESPUÉS del commit (fuera de la
 * transacción, como toda la observabilidad del repo): si el commit fallara,
 * no debe quedar un evento huérfano describiendo un borrado que no ocurrió.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly passwordResetTokens: PasswordResetTokensRepository,
    private readonly carts: CartsRepository,
    private readonly orders: OrdersRepository,
    private readonly events: AccountEventsService,
  ) {}

  async deleteAccount(customerId: string, traceId?: string): Promise<void> {
    let anonymizedOrders: number | null;

    try {
      anonymizedOrders = await this.prisma.$transaction(async (tx) => {
        const bloqueantes = await this.orders.listBlockingForCustomer(customerId, tx);
        if (bloqueantes.length > 0) {
          throw new AccountHasActiveOrdersError(
            bloqueantes.map((o) => OrderHistorySummaryDto.from(o)),
          );
        }

        const anonimizado = await this.customers.anonymize(customerId, tx);
        if (!anonimizado) return null; // AC-15 — ya estaba borrada, no-op idempotente

        await this.refreshTokens.revokeAllForCustomer(customerId, tx);
        await this.passwordResetTokens.deleteAllForCustomer(customerId, tx);
        await this.carts.unlinkAllForCustomer(customerId, tx);
        return this.orders.anonymizeAllForCustomer(customerId, 'account_deletion', tx);
      });
    } catch (error) {
      if (error instanceof AccountHasActiveOrdersError) {
        this.events.emit('account.deletion_blocked', customerId, traceId);
      }
      throw error;
    }

    if (anonymizedOrders === null) return; // AC-15 — sin evento, no hubo borrado nuevo

    this.events.emit('account.deleted', customerId, traceId, {
      anonymized_orders: anonymizedOrders,
    });
  }
}
