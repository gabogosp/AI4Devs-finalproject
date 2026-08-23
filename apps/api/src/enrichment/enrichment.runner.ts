import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentService, ProcessOutcome } from './enrichment.service';
import { AiTransientError } from '../common/errors/enrichment-errors';
import { AI_EMBEDDER, AI_ENRICHER, AiEmbedder, AiEnricher } from './ports/ai.ports';
import { configNumber } from './config-number';

export type RunnerState = 'idle' | 'running' | 'cooldown' | 'disabled';

/** Qué acota una corrida pedida a mano por el dueño (`POST /runs`). */
export interface StartOptions {
  /** Sólo estos productos. Vacío o ausente = todo lo elegible. */
  productIds?: string[];
  /** Devolver a la cola los abandonados antes de barrer (acción explícita, no automática). */
  force?: boolean;
}

export interface StartResult {
  /** Estado con el que responde el pedido de arranque. */
  status: RunnerState | 'already-running';
  /** Productos procesados en esta corrida (0 si no arrancó). */
  processed: number;
  outcomes?: Record<ProcessOutcome, number>;
  /** Cuántos abandonados volvieron a la cola por `force` (0 si no se pidió). */
  rehabilitated?: number;
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
  /** Últimos datos observables por el `/status` (AC-3). */
  private ultimaCorrida: Date | null = null;
  private ultimoErrorCode: string | null = null;

  constructor(
    private readonly repo: EnrichmentRepository,
    private readonly service: EnrichmentService,
    private readonly config: ConfigService,
    @Inject(AI_ENRICHER) private readonly enricher: AiEnricher,
    @Inject(AI_EMBEDDER) private readonly embedder: AiEmbedder,
  ) {}

  /** Estado observable del runner (lo publica el `/status`). */
  get state(): RunnerState {
    if (!this.habilitado) return 'disabled';
    if (this.corriendo) return 'running';
    if (Date.now() < this.cooldownHasta) return 'cooldown';
    return 'idle';
  }

  /** Cuándo terminó la última corrida. `null` si nunca corrió en este proceso. */
  get lastRunAt(): Date | null {
    return this.ultimaCorrida;
  }

  /**
   * Último código de error del proveedor. Es un `type` del catálogo de errores
   * (`dsm:enrichment/*`), **nunca** el mensaje crudo del proveedor: un mensaje crudo puede
   * traer la URL con la clave o el texto del producto, y esto se publica en el `/status`.
   */
  get lastErrorCode(): string | null {
    return this.ultimoErrorCode;
  }

  /**
   * ¿Hay proveedor con el que trabajar?
   *
   * Se le pregunta al **puerto**, no a la configuración: si el runner re-derivara la regla
   * del factory (`sin clave ⇒ adapter deshabilitado`), tendría una copia que puede
   * desincronizarse. Y el costo de equivocarse no es un log: sería arrancar corridas contra
   * un adapter que sólo sabe rechazar, y cada rechazo deja rastro durable —intentos,
   * `error_code`, backoff— en productos que no tienen nada de malo.
   */
  private get habilitado(): boolean {
    const flag = this.config.get<string>('ENRICHMENT_ENABLED', 'true') === 'true';
    return flag && this.embedder.available && this.enricher.available;
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
  async start(opciones: StartOptions = {}): Promise<StartResult> {
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
    let rehabilitados = 0;

    try {
      const batchSize = configNumber(this.config, 'ENRICHMENT_BATCH_SIZE', 25);
      const concurrencia = configNumber(this.config, 'ENRICHMENT_CONCURRENCY', 2);

      // El `force` va ANTES del barrido: rehabilitar después no serviría de nada en esta
      // corrida. Es una acción explícita del dueño, no un reintento automático.
      if (opciones.force) {
        rehabilitados = await this.repo.rehabilitateAbandoned(opciones.productIds);
      }

      for (;;) {
        if (this.breakerAbierto()) break;

        const lote = await this.repo.claimBatch(batchSize, opciones.productIds);
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
      this.ultimaCorrida = new Date();
    }

    return {
      status: this.state,
      processed: procesados,
      outcomes,
      rehabilitated: rehabilitados,
    };
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
      this.ultimoErrorCode = code;
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
