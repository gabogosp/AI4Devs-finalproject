import { Inject, Injectable, Logger } from '@nestjs/common';
import { OrderStatusHistory } from '@dsm/db';
import { OrderWithItems, OrdersRepository } from '../checkout/orders.repository';
import { OrderStatusHistoryRepository } from '../orders/order-status-history.repository';
import { NOTIFICATION_PORT, NotificationPort } from '../orders/ports/notification.port';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockRepository } from '../stock/stock.repository';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';
import { OrderCannotBeCancelledError, OrderNotFoundError } from './payment-confirmation-errors';
import { PaymentsRepository } from './payments.repository';

export interface RefundInfo {
  status: 'refunded' | 'refund_pending' | 'not_applicable';
  provider: 'mercadopago' | 'simulated_dsm' | 'manual' | null;
}

export interface CancelOrderResult {
  order: OrderWithItems;
  history: OrderStatusHistory[];
  refund: RefundInfo;
}

/**
 * Cancelación manual del dueño (US-013, `design.md` §D3): guard de estado →
 * transacción (transición + reintegro de stock + historial + marca de
 * reembolso) → llamada externa a MercadoPago FUERA de la transacción →
 * notificación best-effort → reporte final re-consultado. Vive en
 * `payments/`, no en `orders/` (`design.md` §D1 — evita el ciclo de módulos).
 */
@Injectable()
export class CancelOrderService {
  private readonly logger = new Logger(CancelOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly stock: StockRepository,
    private readonly payments: PaymentsRepository,
    private readonly history: OrderStatusHistoryRepository,
    private readonly events: PaymentsEventsService,
    // Opcionales: `cancel-order.service.spec.ts` construye la clase sin DI,
    // mismo criterio que `ConfirmOrderService` — Nest siempre los provee en
    // producción (`payments.module.ts`).
    @Inject(NOTIFICATION_PORT) private readonly notifications?: NotificationPort,
    private readonly mercadoPago?: MercadoPagoClient,
  ) {}

  async cancel(orderId: string, changedBy: string): Promise<CancelOrderResult> {
    const actual = await this.orders.findById(orderId);
    if (!actual || actual.status === 'pending_payment') {
      throw new OrderNotFoundError(); // fuera de alcance de esta acción
    }
    if (actual.status === 'delivered') {
      this.events.emitRejected(orderId, 'already-delivered');
      throw new OrderCannotBeCancelledError(actual.status); // AC-7, 409
    }

    if (actual.status !== 'cancelled') {
      const cancelada = await this.prisma.$transaction(async (tx) => {
        const c = await this.orders.transitionToCancelledIfActive(orderId, tx);
        if (!c) return null; // carrera: alguien ganó entremedio

        await this.stock.incrementForOrder(
          c.items.map((i) => ({ productId: i.product_id, quantity: i.quantity })),
          tx,
        );
        await this.history.insert(
          { orderId, fromStatus: actual.status, toStatus: 'cancelled', changedBy },
          tx,
        );

        const pago = await this.payments.findApprovedByOrderId(orderId, tx);
        if (pago?.provider === 'mercadopago') {
          await this.payments.markApprovedAsRefundPending(pago.id, tx);
        } else if (pago) {
          // 'simulated_dsm' (AC-5) y 'manual' (proposal.md D3) — mismo no-op externo.
          await this.payments.markApprovedAsRefunded(pago.id, tx);
        }
        return c;
      });

      if (!cancelada) {
        const ahora = await this.orders.findById(orderId);
        if (ahora?.status !== 'cancelled') {
          throw new OrderCannotBeCancelledError(ahora?.status ?? 'desconocido');
        }
        // ya está cancelada (otra llamada ganó la carrera) — cae al camino idempotente abajo.
      } else {
        // FUERA de la transacción: la llamada externa real, nunca dentro de un $transaction.
        const pago = await this.payments.findLatestByOrderId(orderId);
        if (pago?.status === 'refund_pending' && pago.provider === 'mercadopago') {
          try {
            await this.mercadoPago?.refund(pago.external_id!, pago.amount_ars_cents);
            await this.payments.markRefunded(pago.id); // reusa el método de US-010
          } catch {
            this.events.emitRefundFailed(orderId, pago.id); // reusa el evento de US-010
            // Fila queda refund_pending — POST /admin/payments/retry-refunds la recoge
            // sin ningún cambio (listRefundPending ya filtra por status+provider, no por
            // "quién" la puso en refund_pending).
          }
        }
        this.events.emitOwnerCancelled(orderId);
        try {
          await this.notifications?.orderCancelledByOwner({
            orderId: cancelada.id,
            orderNumber: cancelada.order_number,
            buyerName: cancelada.buyer_name,
            buyerEmail: cancelada.buyer_email,
          });
        } catch (error) {
          this.logger.error(
            `NotificationPort falló tras cancelar ${orderId}: ${(error as Error).message}`,
          );
        }
      }
    }

    // Camino idempotente (AC-8) y camino feliz convergen acá: reporta el estado PERSISTIDO.
    const orden = (await this.orders.findById(orderId)) as OrderWithItems;
    const historial = await this.history.listByOrderId(orderId);
    const pagoFinal = await this.payments.findLatestByOrderId(orderId);
    return {
      order: orden,
      history: historial,
      refund: pagoFinal
        ? {
            status: pagoFinal.status as 'refunded' | 'refund_pending',
            provider: pagoFinal.provider as 'mercadopago' | 'simulated_dsm' | 'manual',
          }
        : { status: 'not_applicable', provider: null },
    };
  }
}
