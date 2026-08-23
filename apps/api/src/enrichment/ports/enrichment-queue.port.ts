import { Injectable, Logger } from '@nestjs/common';
import { EnrichmentRunner } from '../enrichment.runner';

/**
 * Puerto de encolado del enriquecimiento IA (definido por US-006 T4.4, movido acá por
 * US-005 T3.5 — el dueño del contrato es el módulo que lo implementa).
 *
 * Existe para que el runner del import no sepa **cómo** se enriquece un producto.
 *
 * Contrato que **todo** adapter debe cumplir:
 *
 * - `enqueue` **nunca propaga**. Un fallo del encolado no puede cambiar el estado de un
 *   import que ya escribió el catálogo: el trabajo terminó bien y lo que falló es una
 *   consecuencia posterior. Si esto propagara, un enriquecimiento caído convertiría imports
 *   exitosos en `failed` y el dueño volvería a subir un archivo que ya está aplicado.
 * - La cola **no es la fuente de verdad**. La marca durable `products.enrichment_done =
 *   false` queda en la base, así que `SELECT ... WHERE enrichment_done = false` reconstruye
 *   el trabajo pendiente aunque ningún encolado haya ocurrido nunca (OQ-BE-4). Es lo que
 *   hace verificable AC-3 sin infraestructura de cola, y lo que permite que el adapter de
 *   hoy sea un empujón en memoria sin perder trabajo.
 */
export interface EnrichmentQueue {
  /**
   * Encola el enriquecimiento de estos productos. Se llama **una vez** por trabajo, con los
   * ids de los creados y los que cambiaron `description_raw`.
   */
  enqueue(productIds: string[]): Promise<void>;
}

/** Token de inyección del puerto. */
export const ENRICHMENT_QUEUE = Symbol('ENRICHMENT_QUEUE');

/**
 * Adapter real (US-005 T3.5): **empuja al ejecutor in-process**, no guarda una cola.
 *
 * Por qué un empujón y no un mensaje: la cola ya existe y es durable —es
 * `WHERE enrichment_done = false`—, así que lo único que falta después de un import es que
 * alguien se entere de que hay trabajo. Un nudge perdido no pierde trabajo: la próxima
 * corrida (manual o disparada por otro import) barre lo mismo. Eso es lo que ADR-0014
 * decidió y su criterio de migración a BullMQ está escrito ahí: cuando exista `REDIS_URL`,
 * el adapter de BullMQ entra por **este mismo token** y ni el import ni el esquema se tocan.
 */
@Injectable()
export class NudgeEnrichmentQueue implements EnrichmentQueue {
  private readonly logger = new Logger(NudgeEnrichmentQueue.name);

  constructor(private readonly runner: EnrichmentRunner) {}

  async enqueue(productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;

    // Se registra el CONTEO, no los ids: un import al tope dejaría 5.000 identificadores en
    // el log sin que nadie los pueda usar. Quien necesite la lista la reconstruye con
    // `enrichment_done = false`.
    this.logger.log(
      `enrichment.pending count=${productIds.length} source=import (nudge in-process — ADR-0014)`,
    );

    try {
      // UN empujón por trabajo, no uno por producto: el runner procesa por lotes todo lo
      // pendiente, así que N kicks harían N veces el mismo barrido.
      this.runner.kick();
    } catch (error) {
      // El contrato manda: el import ya escribió el catálogo y no puede fallar por esto.
      this.logger.warn(
        `el nudge del enriquecimiento falló y se ignora (el trabajo sigue pendiente en la base): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
