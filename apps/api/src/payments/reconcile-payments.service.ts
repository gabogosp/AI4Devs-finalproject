import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { configNumber } from '../enrichment/config-number';
import { OrdersRepository } from '../checkout/orders.repository';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { ConfirmOrderService } from './confirm-order.service';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';

export interface ReconcileResult {
  scanned: number;
  confirmed: number;
  stillPending: number;
}

/**
 * Reconciliación de webhooks faltantes (US-010 AC-10, `design.md` §D8).
 *
 * Sin scheduler in-process (ADR-0012/0014) — se dispara por
 * `POST /v1/admin/payments/reconcile` (T9.2). Toma hasta
 * `RECONCILE_BATCH_SIZE` órdenes `pending_payment` con más de
 * `RECONCILE_MIN_AGE_MS` de antigüedad, y por cada una re-consulta a MP con
 * `searchByExternalReference` — si encuentra un pago `approved`, lo procesa
 * por el MISMO `ConfirmOrderService.confirm()` que usa el webhook: es lo que
 * lo vuelve seguro (idempotente por construcción — reconciliar un pago que
 * el webhook ya procesó es un no-op, T2.2/T5).
 */
@Injectable()
export class ReconcilePaymentsService {
  private readonly logger = new Logger(ReconcilePaymentsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly orders: OrdersRepository,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly confirmOrder: ConfirmOrderService,
    private readonly events: PaymentsEventsService,
  ) {}

  async reconcile(): Promise<ReconcileResult> {
    const minAgeMs = configNumber(this.config, 'RECONCILE_MIN_AGE_MS', 300_000);
    const batchSize = configNumber(this.config, 'RECONCILE_BATCH_SIZE', 50);
    const corte = new Date(Date.now() - minAgeMs);

    const candidatas = (await this.orders.listByStatus('pending_payment'))
      .filter((o) => o.created_at < corte)
      .slice(0, batchSize);

    let confirmed = 0;
    for (const orden of candidatas) {
      try {
        const pagos = await this.mercadoPago.searchByExternalReference(orden.id);
        const aprobado = pagos.find((p) => p.status === 'approved');
        if (!aprobado) continue;

        await this.confirmOrder.confirm({
          orderId: orden.id,
          provider: 'mercadopago',
          externalId: aprobado.id,
          amountArsCents: aprobado.amountArsCents,
        });
        confirmed += 1;
        this.events.emitReconcileRecovered(orden.id);
      } catch (error) {
        // Idempotencia: si otro camino ya la confirmó/canceló entre el
        // listado y acá, confirm() lanza y esta corrida sigue con la
        // siguiente orden — nunca aborta el batch entero por una.
        this.logger.warn(
          `reconcile() no pudo procesar la orden ${orden.id}: ${(error as Error).message}`,
        );
      }
    }

    return {
      scanned: candidatas.length,
      confirmed,
      stillPending: candidatas.length - confirmed,
    };
  }
}
