import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { configNumber } from '../enrichment/config-number';
import { OrdersRepository } from '../checkout/orders.repository';

/**
 * Limpieza de órdenes abandonadas (US-010 AC-11, `design.md` §D8): un solo
 * `updateMany` en bloque (`OrdersRepository.cancelAbandonedPending`, T2.2) —
 * sin condición por fila, no hay carrera que cuidar, sólo un corte de tiempo.
 */
@Injectable()
export class CleanupAbandonedOrdersService {
  constructor(
    private readonly config: ConfigService,
    private readonly orders: OrdersRepository,
  ) {}

  async cleanupAbandoned(): Promise<{ cancelled: number }> {
    const horas = configNumber(this.config, 'ORDER_ABANDON_HOURS', 48);
    const corte = new Date(Date.now() - horas * 3_600_000);
    const cancelled = await this.orders.cancelAbandonedPending(corte);
    return { cancelled };
  }
}
