import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrdersRepository } from './orders.repository';
import { OrdersRetentionEventsService } from '../observability/orders-retention-events.service';
import { OrderNotFoundError } from './checkout-errors';
import { AnonymizationReason } from './order-anonymization';

export interface AnonymizeResult {
  anonymizedAt: Date;
  anonymizationReason: AnonymizationReason;
}

/**
 * US-021 — retención y anonimización de PII de órdenes (Ley 25.326).
 * `design.md` §Approach ("Servicio, endpoints y runner").
 */
@Injectable()
export class OrdersRetentionService {
  private readonly retentionMonths: number;

  constructor(
    private readonly orders: OrdersRepository,
    private readonly events: OrdersRetentionEventsService,
    config: ConfigService,
  ) {
    this.retentionMonths = config.get<number>('ORDER_RETENTION_MONTHS') ?? 12;
  }

  /**
   * Anonimización a pedido (AC-3). `reason` fijo en `'requested'`, nunca
   * parametrizable desde afuera del servicio.
   */
  async anonymizeOnRequest(orderId: string): Promise<AnonymizeResult> {
    const existente = await this.orders.findById(orderId);
    if (!existente) throw new OrderNotFoundError();

    const yaAnonimizada = existente.anonymized_at !== null;
    const result = await this.orders.anonymize(orderId, 'requested');
    if (!result) throw new OrderNotFoundError();

    // AC-8: sobre una orden ya anonimizada, "sin error" y también SIN un
    // segundo evento — la primera anonimización ya lo emitió.
    if (!yaAnonimizada) {
      this.events.emit('orders_retention.anonymized_on_request', orderId);
    }
    return result;
  }

  /** Barrido por plazo cumplido (AC-1). `reason` fijo en `'retention_policy'`. */
  async runRetentionSweep(): Promise<number> {
    const cutoff = this.cutoffDate();
    const count = await this.orders.anonymizeRetentionEligible(cutoff, 'retention_policy');
    // Siempre se emite, incluso count=0: "registrar cuántas órdenes anonimiza
    // CADA corrida" (US §9) es también la señal de que el barrido corrió.
    this.events.emit('orders_retention.swept', null, undefined, {
      anonymized_count: count,
    });
    return count;
  }

  private cutoffDate(): Date {
    const d = new Date();
    d.setMonth(d.getMonth() - this.retentionMonths);
    return d;
  }
}
