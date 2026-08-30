import { Injectable } from '@nestjs/common';
import { Payment, Prisma } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import { isPrismaError, PRISMA_UNIQUE_VIOLATION } from '../common/prisma-errors';
import { OrderNotPendingPaymentError } from './payment-confirmation-errors';

export interface CreateManualPaymentData {
  orderId: string;
  amountArsCents: number;
  confirmedBy: string;
}

/**
 * Único punto de ORM que escribe `payments` (`design.md` §Approach). El
 * `idempotency_key` determinístico (`manual:{orderId}`) es el guard de
 * AC-5: un segundo intento sobre la misma orden pega contra la constraint
 * UNIQUE y se traduce acá a `OrderNotPendingPaymentError`, la misma que usa
 * el guard de `orders.transitionToNewIfPending` — un solo tipo de error para
 * "no se puede confirmar" (AC-4/AC-5 unificados).
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createManualPayment(
    data: CreateManualPaymentData,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Payment> {
    try {
      return await tx.payment.create({
        data: {
          order_id: data.orderId,
          provider: 'manual',
          status: 'approved',
          external_id: null,
          amount_ars_cents: data.amountArsCents,
          idempotency_key: `manual:${data.orderId}`,
          processed_at: new Date(),
          confirmed_by: data.confirmedBy,
        },
      });
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        // Ya existe un pago manual para esta orden (defensa en profundidad —
        // el guard principal es transitionToNewIfPending, design.md §Approach).
        throw new OrderNotPendingPaymentError();
      }
      throw error;
    }
  }
}
