import { Injectable } from '@nestjs/common';
import { OrdersRepository } from '../checkout/orders.repository';
import { PrismaService } from '../prisma/prisma.service';
import { StockRepository } from '../stock/stock.repository';
import { OrderNotFoundError, OrderNotPendingPaymentError } from './payment-confirmation-errors';
import {
  ConfirmedPayment,
  ConfirmPaymentInput,
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
  ) {}

  async confirm(input: ConfirmPaymentInput): Promise<ConfirmedPayment> {
    const orden = await this.orders.findById(input.orderId);
    if (!orden) {
      throw new OrderNotFoundError();
    }
    if (orden.status !== 'pending_payment') {
      throw new OrderNotPendingPaymentError(orden.status);
    }

    return this.prisma.$transaction(async (tx) => {
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
        status: 'new',
        paymentId: pago.id,
      };
    });
  }
}
