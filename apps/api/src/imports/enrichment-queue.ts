import { Injectable, Logger } from '@nestjs/common';

/**
 * Puerto de encolado del enriquecimiento IA (§3 — depender del token de
 * inyección, no de la clase concreta).
 *
 * Existe para que el runner del import no sepa **cómo** se enriquece un
 * producto. Hoy hay un solo adapter —el que registra el conteo— porque el add-on
 * de Redis no está aprovisionado; cuando lo esté, el adapter de BullMQ entra por
 * este mismo token y el import no se toca.
 * `Deferred: adapter BullMQ — US-005 (+ Redis de US-019) — owner: Arquitecto`.
 *
 * Contrato que **todo** adapter debe cumplir:
 *
 * - `enqueue` **nunca propaga**. Un fallo de la cola no puede cambiar el estado
 *   de un import que ya escribió el catálogo: el trabajo terminó bien y lo que
 *   falló es una consecuencia posterior. Si esto propagara, un Redis caído
 *   convertiría imports exitosos en `failed` y el dueño volvería a subir un
 *   archivo que ya está aplicado.
 * - La cola **no es la fuente de verdad**. La marca durable
 *   `products.enrichment_done = false` queda en la base, así que
 *   `SELECT ... WHERE enrichment_done = false` reconstruye el trabajo pendiente
 *   aunque ningún encolado haya ocurrido nunca (OQ-BE-4). Es lo que hace
 *   verificable AC-3 sin infraestructura de cola.
 */
export interface EnrichmentQueue {
  /**
   * Encola el enriquecimiento de estos productos. Se llama **una vez** por
   * trabajo, con los ids de los creados y los que cambiaron `description_raw`.
   */
  enqueue(productIds: string[]): Promise<void>;
}

/** Token de inyección del puerto. */
export const ENRICHMENT_QUEUE = Symbol('ENRICHMENT_QUEUE');

/**
 * Adapter interino: registra cuántos productos quedaron pendientes y **no
 * intenta conectarse a Redis** (no está aprovisionado — ADR-0012).
 *
 * No es un stub vacío por comodidad: es la mitad honesta de la decisión. La otra
 * mitad —la que hace que no se pierda trabajo— es la columna `enrichment_done`,
 * que US-005 va a barrer cuando exista el worker.
 */
@Injectable()
export class LoggingEnrichmentQueue implements EnrichmentQueue {
  private readonly logger = new Logger(LoggingEnrichmentQueue.name);

  async enqueue(productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;
    // Se registra el CONTEO, no los ids: un import al tope dejaría 5.000
    // identificadores en el log sin que nadie los pueda usar. Quien necesite la
    // lista la reconstruye con `enrichment_done = false`.
    this.logger.log(
      `enrichment.pending count=${productIds.length} source=import (encolado real diferido a US-005)`,
    );
  }
}
