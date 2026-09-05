import { Inject, Injectable, Logger } from '@nestjs/common';
import { Order, Payment, Prisma } from '@dsm/db';
import { OrdersRepository } from '../checkout/orders.repository';
import { NOTIFICATION_PORT, NotificationPort } from '../orders/ports/notification.port';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockRepository } from '../stock/stock.repository';
import { InsufficientStockError } from '../stock/stock-errors';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';
import {
  OrderAutoCancelledInsufficientStockError,
  OrderNotFoundError,
  OrderNotPendingPaymentError,
} from './payment-confirmation-errors';
import {
  ConfirmedPayment,
  ConfirmManualPaymentInput,
  ConfirmWebhookPaymentInput,
  PaymentConfirmationPort,
} from './payment-confirmation.port';
import { PaymentsRepository } from './payments.repository';

type ConfirmInput = ConfirmManualPaymentInput | ConfirmWebhookPaymentInput;

/**
 * Implementa `PaymentConfirmationPort`. La rama `provider: 'manual'` (US-023)
 * queda **exactamente igual, línea por línea** — las tres escrituras de
 * `design.md` §Approach en una sola transacción Prisma:
 *
 * 1. `orders.transitionToNewIfPending` (guardada por `WHERE status`, corta
 *    acá si la orden no está `pending_payment` — AC-4/AC-5).
 * 2. `stock.decrementForOrder` (atómico condicional, ADR-0008 — si falta
 *    stock en cualquier línea, la transacción entera revierte, la orden NO
 *    queda en `new`).
 * 3. `crearPago` (T5.1) — `createManualPayment` para `manual`,
 *    `createApprovedPayment` para `mercadopago`/`simulated_dsm` (US-010).
 *
 * `orders.findById` corre ANTES de abrir la transacción para poder
 * distinguir 404 (no existe) de 409 (existe, pero no `pending_payment`) —
 * algo que el `updateMany` guardado del paso 1 no puede por sí solo.
 *
 * US-010 amplía el mismo método (`design.md` §D1 — AC-9 estructural, un solo
 * camino de confirmación): dos ramas nuevas que sólo corren para
 * `provider !== 'manual'` — el evento (T5.2), las notificaciones tras el
 * commit (T5.3) y la compensación sin stock (T5.4-T5.6).
 */
@Injectable()
export class ConfirmOrderService implements PaymentConfirmationPort {
  private readonly logger = new Logger(ConfirmOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly stock: StockRepository,
    private readonly payments: PaymentsRepository,
    private readonly events: PaymentsEventsService,
    // Opcionales: `confirm-order.service.spec.ts` (US-023) construye la clase con 5
    // argumentos, sin DI — no debe romperse (T5.1 Exit criterion, cero modificación).
    // Nest siempre los provee en producción (`payments.module.ts`); sólo la rama
    // `provider !== 'manual'` los usa, guardados con `?.`.
    @Inject(NOTIFICATION_PORT) private readonly notifications?: NotificationPort,
    private readonly mercadoPago?: MercadoPagoClient,
  ) {}

  async confirm(input: ConfirmInput): Promise<ConfirmedPayment> {
    const orden = await this.orders.findById(input.orderId);
    if (!orden) {
      throw new OrderNotFoundError();
    }
    if (orden.status !== 'pending_payment') {
      this.events.emitRejected(input.orderId, 'not-pending-payment');
      throw new OrderNotPendingPaymentError(orden.status);
    }

    let ordenConfirmada: Order | undefined;

    try {
      const resultado = await this.prisma.$transaction(async (tx) => {
        const confirmada = await this.orders.transitionToNewIfPending(input.orderId, tx);
        if (!confirmada) {
          // Carrera: alguien más confirmó/canceló entre el chequeo de arriba y acá.
          throw new OrderNotPendingPaymentError();
        }

        await this.stock.decrementForOrder(
          confirmada.items.map((item) => ({
            productId: item.product_id,
            quantity: item.quantity,
          })),
          tx,
        );

        const pago = await this.crearPago(input, confirmada, tx);
        ordenConfirmada = confirmada;

        return {
          orderId: confirmada.id,
          orderNumber: confirmada.order_number,
          status: 'new' as const,
          paymentId: pago.id,
        };
      });

      if (input.provider === 'manual') {
        this.events.emitConfirmed(input.orderId);
      } else {
        this.events.emitProviderConfirmed(input.orderId, input.provider);
        // T5.3: FUERA de la transacción, ya comiteada. Un fallo del puerto se
        // loguea pero NUNCA revierte la confirmación ya comiteada.
        await this.notificarConfirmacion(resultado, ordenConfirmada!);
      }
      return resultado;
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        this.events.emitRejected(input.orderId, 'insufficient-stock');
        if (input.provider === 'manual') {
          throw error; // rama manual sin cambios (T5.4)
        }
        await this.compensarSinStock(input);
        throw new OrderAutoCancelledInsufficientStockError();
      } else if (error instanceof OrderNotPendingPaymentError) {
        this.events.emitRejected(input.orderId, 'not-pending-payment');
      }
      throw error;
    }
  }

  /** T5.1 — despacha la creación del pago por `provider`. */
  private async crearPago(
    input: ConfirmInput,
    confirmada: { id: string; total_ars_cents: number },
    tx: Prisma.TransactionClient,
  ): Promise<Payment> {
    if (input.provider === 'manual') {
      return this.payments.createManualPayment(
        {
          orderId: confirmada.id,
          amountArsCents: confirmada.total_ars_cents,
          confirmedBy: input.confirmedBy,
        },
        tx,
      );
    }
    return this.payments.createApprovedPayment(
      {
        orderId: confirmada.id,
        provider: input.provider,
        externalId: input.externalId,
        amountArsCents: input.amountArsCents,
      },
      tx,
    );
  }

  /** T5.3 — notificaciones tras el commit, sólo para providers automáticos. */
  private async notificarConfirmacion(
    resultado: ConfirmedPayment,
    orden: Order,
  ): Promise<void> {
    try {
      await this.notifications?.orderConfirmed({
        orderId: resultado.orderId,
        orderNumber: resultado.orderNumber,
        buyerName: orden.buyer_name,
        buyerEmail: orden.buyer_email,
      });
      await this.notifications?.ownerNewOrder({
        orderId: resultado.orderId,
        orderNumber: resultado.orderNumber,
        totalArsCents: orden.total_ars_cents,
      });
    } catch (error) {
      this.logger.error(
        `NotificationPort falló tras confirmar ${resultado.orderId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * T5.4-T5.6 — compensación cuando un pago automático se aprobó pero no
   * había stock. Transacción NUEVA e independiente de la que ya revirtió
   * (`design.md` §D2 — el reembolso no puede ejecutarse dentro de una
   * transacción abierta).
   */
  private async compensarSinStock(input: ConfirmWebhookPaymentInput): Promise<void> {
    const resultado = await this.prisma.$transaction(async (tx) => {
      const cancelada = await this.orders.transitionToCancelledIfPending(input.orderId, tx);
      if (!cancelada) return null; // carrera: ya la cancelaron/confirmaron (T5.4)

      const pago = await this.payments.createRefundPendingPayment(
        {
          orderId: input.orderId,
          provider: input.provider,
          externalId: input.externalId,
          amountArsCents: input.amountArsCents,
        },
        tx,
      );
      return { cancelada, pago };
    });
    if (!resultado) return;

    // T5.5 — fuera de toda transacción.
    if (input.provider === 'simulated_dsm') {
      await this.payments.markRefunded(resultado.pago.id);
    } else {
      try {
        await this.mercadoPago?.refund(input.externalId, input.amountArsCents);
        await this.payments.markRefunded(resultado.pago.id);
      } catch {
        // La fila QUEDA refund_pending — nunca se marca fallido definitivo (AC-4 durable).
        this.events.emitRefundFailed(input.orderId, resultado.pago.id);
      }
    }

    // T5.6
    this.events.emitAutoCancelled(input.orderId);
    try {
      await this.notifications?.orderCancelledNoStock({
        orderId: resultado.cancelada.id,
        orderNumber: resultado.cancelada.order_number,
        buyerName: resultado.cancelada.buyer_name,
        buyerEmail: resultado.cancelada.buyer_email,
      });
    } catch (error) {
      this.logger.error(
        `NotificationPort falló tras cancelar ${input.orderId}: ${(error as Error).message}`,
      );
    }
  }
}
