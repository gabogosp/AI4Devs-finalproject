import { Inject, Injectable } from '@nestjs/common';
import { OrdersRepository } from '../checkout/orders.repository';
import { NOTIFICATION_PORT, NotificationPort } from '../orders/ports/notification.port';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockRepository } from '../stock/stock.repository';
import { InsufficientStockError } from '../stock/stock-errors';
import { OrderNotFoundError, OrderNotPendingPaymentError } from './payment-confirmation-errors';
import {
  ConfirmedPayment,
  ConfirmManualPaymentInput,
  PaymentConfirmationPort,
} from './payment-confirmation.port';
import { PaymentsRepository } from './payments.repository';

/**
 * Implementa `PaymentConfirmationPort` para el proveedor `manual` — las
 * tres escrituras de `design.md` §Approach en una sola transacción Prisma:
 *
 * 1. `orders.transitionToNewIfPending` (guardada por `WHERE status`, corta
 *    acá si la orden no está `pending_payment` — AC-4/AC-5).
 * 2. `stock.decrementForOrder` (atómico condicional, ADR-0008 — si falta
 *    stock en cualquier línea, la transacción entera revierte, la orden NO
 *    queda en `new`).
 * 3. `payments.createManualPayment` (registro auditable, AC-6).
 *
 * `orders.findById` corre ANTES de abrir la transacción para poder
 * distinguir 404 (no existe) de 409 (existe, pero no `pending_payment`) —
 * algo que el `updateMany` guardado del paso 1 no puede por sí solo.
 */
@Injectable()
export class ConfirmOrderService implements PaymentConfirmationPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly stock: StockRepository,
    private readonly payments: PaymentsRepository,
    private readonly events: PaymentsEventsService,
    // Opcional: `confirm-order.service.spec.ts` (US-023) construye la clase con 5
    // argumentos, sin DI — no debe romperse (T5.1 Exit criterion, cero modificación).
    // Nest siempre lo provee en producción (`payments.module.ts` T8.2); sólo la rama
    // `provider !== 'manual'` (T5.3/T5.6) lo usa, guardado con `?.`.
    @Inject(NOTIFICATION_PORT) private readonly notifications?: NotificationPort,
  ) {}

  async confirm(input: ConfirmManualPaymentInput): Promise<ConfirmedPayment> {
    const orden = await this.orders.findById(input.orderId);
    if (!orden) {
      throw new OrderNotFoundError();
    }
    if (orden.status !== 'pending_payment') {
      this.events.emitRejected(input.orderId, 'not-pending-payment');
      throw new OrderNotPendingPaymentError(orden.status);
    }

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

        const pago = await this.payments.createManualPayment(
          {
            orderId: confirmada.id,
            amountArsCents: confirmada.total_ars_cents,
            confirmedBy: input.confirmedBy,
          },
          tx,
        );

        return {
          orderId: confirmada.id,
          orderNumber: confirmada.order_number,
          status: 'new' as const,
          paymentId: pago.id,
        };
      });

      this.events.emitConfirmed(input.orderId);
      return resultado;
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        this.events.emitRejected(input.orderId, 'insufficient-stock');
      } else if (error instanceof OrderNotPendingPaymentError) {
        this.events.emitRejected(input.orderId, 'not-pending-payment');
      }
      throw error;
    }
  }
}
