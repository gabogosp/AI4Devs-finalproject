import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentService, ProcessOutcome } from './enrichment.service';
import { AiTransientError } from '../common/errors/enrichment-errors';
import { configNumber } from './config-number';

export type RunnerState = 'idle' | 'running' | 'cooldown' | 'disabled';

export interface StartResult {
  /** Estado con el que responde el pedido de arranque. */
  status: RunnerState | 'already-running';
  /** Productos procesados en esta corrida (0 si no arrancó). */
  processed: number;
  outcomes?: Record<ProcessOutcome, number>;
}

/**
 * Ejecutor in-process del enriquecimiento (US-005 T3.4, ADR-0014).
 *
 * No hay cola de mensajes: la cola **es** `WHERE enrichment_done = false` y el claim por
 * lease (T2.1) es lo que hace segura la concurrencia. Esto es lo que ADR-0014 decidió y su
 * criterio de migración a BullMQ está escrito ahí: cuando exista `REDIS_URL` y el `worker`
 * desplegado, se cambia el disparador y **no** el esquema ni el contrato.
 *
 * Tres cosas que este archivo tiene que garantizar:
 *
 * 1. **No bloquear el event loop** (`backend-node-standards` §8): se procesa de a lotes con
 *    `await` entre ellos, y dentro del lote de a `ENRICHMENT_CONCURRENCY`. La API sigue
 *    respondiendo mientras el catálogo se enriquece — es el precio declarado de correr
 *    in-process, y se paga con cortesía, no ignorándolo.
 * 2. **Una sola corrida a la vez**: un segundo `start()` no arranca un segundo bucle. El
 *    claim por lease ya cubre el caso multi-réplica; esta guarda cubre el mismo proceso.
 * 3. **Cortar cuando el proveedor está caído** (AC-4): tras `ENRICHMENT_FAILURE_THRESHOLD`
 *    fallos **consecutivos** entra en `cooldown` y deja de llamar. Seguir insistiendo contra
 *    un proveedor caído sólo quema cuota que después falta para el catálogo real.
 */
@Injectable()
export class EnrichmentRunner {
  private readonly logger = new Logger(EnrichmentRunner.name);
  private corriendo = false;
  private fallosConsecutivos = 0;
  /** Instante hasta el que el breaker está abierto. */
  private cooldownHasta = 0;

  constructor(
    private readonly repo: EnrichmentRepository,
    private readonly service: EnrichmentService,
    private readonly config: ConfigService,
  ) {}

  /** Estado observable del runner (lo publica el `/status`). */
  get state(): RunnerState {
    if (!this.habilitado) return 'disabled';
    if (this.corriendo) return 'running';
    if (Date.now() < this.cooldownHasta) return 'cooldown';
    return 'idle';
  }

  private get habilitado(): boolean {
    return this.config.get<string>('ENRICHMENT_ENABLED', 'true') === 'true';
  }

  /**
   * Empujón sin esperar: lo usa el adapter de la cola tras un import (T3.5).
   *
   * `setImmediate` devuelve el control al event loop antes de arrancar, así el request que
   * disparó el import no espera por el enriquecimiento.
   */
  kick(): void {
    if (this.state !== 'idle') return;
    setImmediate(() => {
      void this.start().catch((error: unknown) => {
        // Un fallo del runner no puede tumbar el proceso que lo empujó.
        this.logger.error(
          `la corrida disparada por nudge terminó con error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    });
  }

  /**
   * Procesa todos los pendientes, en lotes, hasta que no quede ninguno elegible.
   *
   * Devuelve por qué no arrancó cuando corresponde, en vez de fingir que corrió: el
   * endpoint admin necesita poder responder 409 con una razón (T4.2).
   */
  async start(): Promise<StartResult> {
    if (!this.habilitado) return { status: 'disabled', processed: 0 };
    if (this.corriendo) return { status: 'already-running', processed: 0 };
    if (Date.now() < this.cooldownHasta) return { status: 'cooldown', processed: 0 };

    this.corriendo = true;
    const outcomes: Record<ProcessOutcome, number> = {
      enriched_and_embedded: 0,
      embedded_from_curated: 0,
      embedded_only: 0,
      skipped_unchanged: 0,
    };
    let procesados = 0;

    try {
      const batchSize = configNumber(this.config, 'ENRICHMENT_BATCH_SIZE', 25);
      const concurrencia = configNumber(this.config, 'ENRICHMENT_CONCURRENCY', 2);

      for (;;) {
        if (this.breakerAbierto()) break;

        const lote = await this.repo.claimBatch(batchSize);
        if (lote.length === 0) break;

        const nombres = await this.repo.categoryNames(
          [...new Set(lote.map((p) => p.category_id))],
        );

        // De a `concurrencia` productos: el `await` de cada tramo devuelve el control al
        // event loop, así la API sigue atendiendo requests durante la corrida.
        for (let i = 0; i < lote.length; i += concurrencia) {
          if (this.breakerAbierto()) break;
          const tramo = lote.slice(i, i + concurrencia);
          const resultados = await Promise.all(
            tramo.map((producto) =>
              this.procesarUno(producto.id, () =>
                this.service.processProduct(
                  producto,
                  nombres.get(producto.category_id) ?? '',
                ),
              ),
            ),
          );
          for (const r of resultados) {
            if (r) {
              outcomes[r] += 1;
              procesados += 1;
            }
          }
        }
      }
    } finally {
      this.corriendo = false;
    }

    return { status: this.state, processed: procesados, outcomes };
  }

  /**
   * Procesa un producto contando fallos consecutivos. Devuelve `null` si falló: el fallo
   * ya quedó registrado en la base con su backoff (T3.3), así que la corrida sigue con el
   * siguiente producto en vez de abortar el lote entero por uno malo.
   */
  private async procesarUno(
    productId: string,
    fn: () => Promise<ProcessOutcome>,
  ): Promise<ProcessOutcome | null> {
    try {
      const outcome = await fn();
      this.fallosConsecutivos = 0; // un éxito reinicia el contador del breaker
      return outcome;
    } catch (error) {
      const code =
        error instanceof AiTransientError
          ? 'dsm:enrichment/ai-transient'
          : error instanceof Error && 'type' in error
            ? String((error as { type: unknown }).type)
            : 'dsm:enrichment/unknown';
      await this.service.registerFailure(productId, code);

      this.fallosConsecutivos += 1;
      const umbral = configNumber(this.config, 'ENRICHMENT_FAILURE_THRESHOLD', 5);
      if (this.fallosConsecutivos >= umbral) {
        const cooldownMs = configNumber(this.config, 'ENRICHMENT_COOLDOWN_MS', 300_000);
        this.cooldownHasta = Date.now() + cooldownMs;
        this.logger.warn(
          `${this.fallosConsecutivos} fallos consecutivos del proveedor: cooldown por ${cooldownMs} ms. Seguir llamando sólo quemaría cuota.`,
        );
      }
      return null;
    }
  }

  private breakerAbierto(): boolean {
    return Date.now() < this.cooldownHasta;
  }

  /** Sólo para tests: olvida el estado del breaker. */
  resetBreaker(): void {
    this.fallosConsecutivos = 0;
    this.cooldownHasta = 0;
  }
}
