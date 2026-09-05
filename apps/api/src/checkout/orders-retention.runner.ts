import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OrdersRetentionService } from './orders-retention.service';

/**
 * US-021 — barrido oportunista de retención al arrancar la API, mismo patrón
 * que `ImportRunner` (ADR-0012): corre el barrido una vez al levantar el
 * proceso, best-effort. Cubre el hueco de un redeploy que se salta el
 * disparador externo mensual. `Deferred: operaciones / US-019` para el
 * processor BullMQ real cuando `REDIS_URL` exista (design.md §Approach).
 */
@Injectable()
export class OrdersRetentionRunner implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrdersRetentionRunner.name);

  constructor(private readonly retention: OrdersRetentionService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const count = await this.retention.runRetentionSweep();
      if (count > 0) {
        this.logger.log(`orders_retention: ${count} orden(es) anonimizada(s) al arrancar`);
      }
    } catch (error) {
      // Un fallo del barrido NUNCA impide que la API levante.
      this.logger.error(
        `orders_retention: falló el barrido de arranque: ${(error as Error).message}`,
      );
    }
  }
}
