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

export interface CreateProviderPaymentData {
  orderId: string;
  provider: 'mercadopago' | 'simulated_dsm';
  externalId: string;
  amountArsCents: number;
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

  /**
   * Pago aprobado por webhook o medio simulado (US-010 AC-1, AC-9).
   * `idempotency_key: '{provider}:{externalId}'` es el guard de duplicados
   * (AC-5/AC-6): un segundo webhook con el mismo `externalId` pega contra la
   * UNIQUE y se traduce al mismo `OrderNotPendingPaymentError` que usa el
   * camino `manual` — un solo tipo de error para "no se puede confirmar".
   */
  async createApprovedPayment(
    data: CreateProviderPaymentData,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Payment> {
    try {
      return await tx.payment.create({
        data: {
          order_id: data.orderId,
          provider: data.provider,
          status: 'approved',
          external_id: data.externalId,
          amount_ars_cents: data.amountArsCents,
          idempotency_key: `${data.provider}:${data.externalId}`,
          processed_at: new Date(),
          confirmed_by: null,
        },
      });
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new OrderNotPendingPaymentError();
      }
      throw error;
    }
  }

  /**
   * Reembolso pendiente (US-010 AC-4 durable, `design.md` §D2): registra el
   * pago aprobado que resultó sin stock ANTES de intentar el reembolso real
   * — la fila existe aunque `MercadoPagoClient.refund` falle, que es
   * exactamente lo que hace durable el reintento (T11.1). `idempotency_key`
   * con sufijo `:refund` para no chocar con la fila `approved` que pudiera
   * existir para el mismo `{provider, externalId}` en una reconciliación.
   */
  async createRefundPendingPayment(
    data: CreateProviderPaymentData,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Payment> {
    try {
      return await tx.payment.create({
        data: {
          order_id: data.orderId,
          provider: data.provider,
          status: 'refund_pending',
          external_id: data.externalId,
          amount_ars_cents: data.amountArsCents,
          idempotency_key: `${data.provider}:${data.externalId}:refund`,
          processed_at: new Date(),
          confirmed_by: null,
        },
      });
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new OrderNotPendingPaymentError();
      }
      throw error;
    }
  }

  /**
   * Cierre del reembolso (US-010 AC-4, `design.md` §D2): `UPDATE ... WHERE
   * id=$id AND status='refund_pending'` guardado — un segundo intento sobre
   * una fila ya `refunded` (o cualquier otro estado) es un no-op, nunca un
   * doble reembolso.
   */
  async markRefunded(
    paymentId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Payment | null> {
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: 'refund_pending' },
      data: { status: 'refunded' },
    });
    if (count === 0) return null;
    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  }

  /**
   * Reembolsos pendientes de reintentar (US-010 AC-4 durable, T11.1) — sólo
   * `provider='mercadopago'`: el simulado nunca se atasca acá (no hay
   * llamada externa que pueda fallar, `markRefunded` corre directo). Más
   * viejas primero — son las que más esperaron.
   */
  listRefundPending(limit: number): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { status: 'refund_pending', provider: 'mercadopago' },
      orderBy: { created_at: 'asc' },
      take: limit,
    });
  }

  /**
   * Pago `approved` vigente de una orden (US-013 AC-3): `CancelOrderService`
   * lo usa para decidir si hay algo que reembolsar y de qué `provider`. Más
   * nuevo primero por si alguna vez hubiera más de un `approved` histórico
   * (no debería, pero no es este método el que lo garantiza).
   */
  findApprovedByOrderId(
    orderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Payment | null> {
    return tx.payment.findFirst({
      where: { order_id: orderId, status: 'approved' },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Último pago de una orden, cualquier estado (US-013 D3): usado al final
   * de `cancel()` para reportar el estado PERSISTIDO del reembolso — incluye
   * lo que la llamada externa a MercadoPago (fuera de la tx) pudo haber
   * cambiado después de que la transacción cerró.
   */
  findLatestByOrderId(
    orderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Payment | null> {
    return tx.payment.findFirst({
      where: { order_id: orderId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Marca un pago `approved` como `refund_pending` (US-013 AC-3, camino
   * `mercadopago`): `UPDATE ... WHERE status='approved'` guardado, mismo
   * criterio que `markRefunded` — un reintento sobre una fila que ya no está
   * `approved` es un no-op, nunca un segundo cambio de estado.
   */
  async markApprovedAsRefundPending(
    paymentId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Payment | null> {
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: 'approved' },
      data: { status: 'refund_pending' },
    });
    if (count === 0) return null;
    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  }

  /**
   * Marca un pago `approved` como `refunded` directo (US-013 AC-5): camino
   * `simulated_dsm`/`manual` — no hay llamada externa que pueda fallar, así
   * que el reembolso "sucede" en el mismo `UPDATE` guardado que el resto de
   * los métodos `markApprovedAs*`.
   */
  async markApprovedAsRefunded(
    paymentId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Payment | null> {
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: 'approved' },
      data: { status: 'refunded' },
    });
    if (count === 0) return null;
    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  }
}
