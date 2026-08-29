import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import {
  AiDisabledError,
  EnrichmentCooldownError,
  EnrichmentRunInProgressError,
} from '../common/errors/enrichment-errors';
import {
  EnrichmentStatusResponseDto,
  StartEnrichmentRunDto,
  StartEnrichmentRunResponse,
} from './dto/enrichment.dto';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentRunner } from './enrichment.runner';
import { EnrichmentThrottlerGuard } from './enrichment-throttler.guard';

/**
 * Presupuesto del `POST` (§7.3). Se lee de `process.env` porque los decoradores se evalúan
 * al cargar la clase, antes del contenedor — mismo criterio que el cap del import. Zod ya
 * validó el valor al arrancar.
 */
const RATE_LIMIT_MAX = Number(process.env.ENRICHMENT_RATE_LIMIT_MAX ?? 6);
const RATE_LIMIT_TTL_MS = Number(process.env.ENRICHMENT_RATE_LIMIT_TTL_MS ?? 60_000);

/**
 * Superficie admin del enriquecimiento (US-005 AC-3). Gateada por `AdminGuard` (ADR-0009):
 * el guard se reusa tal cual, no se modifica.
 *
 * El throttler nombrado `enrichment` es propio y no el de `auth`: el presupuesto de `auth`
 * es de login, y compartirlo haría que unas cuantas corridas dejen al dueño sin poder
 * entrar al panel. Los presupuestos ajenos se saltean explícitamente para que esta
 * superficie no consuma el de nadie.
 */
@Controller('v1/admin/enrichment')
@UseGuards(AdminGuard, EnrichmentThrottlerGuard)
@SkipThrottle({ auth: true, storefront: true, cart: true })
export class EnrichmentController {
  constructor(
    private readonly repo: EnrichmentRepository,
    private readonly runner: EnrichmentRunner,
    private readonly config: ConfigService,
  ) {}

  /**
   * Cobertura observable del catálogo (AC-3).
   *
   * Es la respuesta a «¿la búsqueda semántica va a funcionar?» antes de que un cliente la
   * pruebe: sin esto, un catálogo con 3 de 800 productos embeddeados se ve idéntico a uno
   * completo hasta que alguien busca y no encuentra nada.
   *
   * El panel lo consulta en loop mientras corre un run, así que **no** gasta el presupuesto
   * del `POST`: mirar el progreso no puede dejar al dueño sin poder disparar una corrida.
   */
  @Get('status')
  @SkipThrottle({ enrichment: true })
  async status(): Promise<EnrichmentStatusResponseDto> {
    const coverage = await this.repo.coverage();
    return EnrichmentStatusResponseDto.from({
      runnerState: this.runner.state,
      coverage,
      enrichModel: this.config.get<string>('GEMINI_ENRICH_MODEL', 'gemini-1.5-flash'),
      embedModel: this.config.get<string>('GEMINI_EMBED_MODEL', 'text-embedding-004'),
      lastErrorCode: this.runner.lastErrorCode,
      lastRunAt: this.runner.lastRunAt,
    });
  }

  /**
   * Dispara una corrida (202) o rechaza el pedido si ya hay una en curso (409).
   *
   * **202 y no 200**: una corrida sobre miles de productos no cabe en el tiempo de un
   * request, y el dueño necesita ver progreso en vez de un timeout (api-standards §10). El
   * estado se consulta en `GET status`.
   *
   * El `run_id` es un identificador de correlación para los logs de esta corrida, no una
   * fila: el trabajo pendiente ya es durable en `products.enrichment_done`, así que una
   * tabla de corridas sería estado duplicado que puede desincronizarse del catálogo.
   */
  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  // Cada corrida son llamadas pagas al proveedor: el presupuesto es deliberadamente chico.
  @Throttle({ enrichment: { limit: RATE_LIMIT_MAX, ttl: RATE_LIMIT_TTL_MS } })
  async startRun(
    @Body() body: StartEnrichmentRunDto,
  ): Promise<StartEnrichmentRunResponse> {
    // Se rechaza ANTES de arrancar, y con el código que corresponde a cada motivo. El
    // chequeo de adentro del runner también existe (es el que hace segura la concurrencia
    // real), pero el borde HTTP tiene que responder algo verdadero y no un 202 que miente
    // sobre haber arrancado una corrida.
    const estado = this.runner.state;
    // Sin proveedor no es «ocupado»: es que no hay con qué trabajar. Un 409 mandaría al dueño
    // a esperar un progreso que nunca va a existir.
    if (estado === 'disabled') throw new AiDisabledError();
    if (estado === 'cooldown') throw new EnrichmentCooldownError();
    if (estado !== 'idle') throw new EnrichmentRunInProgressError(estado);

    const runId = randomUUID();
    // Sin `await`: el request devuelve 202 y la corrida sigue. Un fallo acá no puede tumbar
    // el proceso, y el detalle queda en el `/status` y en los eventos.
    void this.runner
      .start({ force: body.force, productIds: body.product_ids })
      .catch(() => undefined);

    return { run_id: runId, accepted: true };
  }
}
