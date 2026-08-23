import { IsArray, IsBoolean, IsOptional, IsUUID, ArrayMaxSize } from 'class-validator';
import { CoverageSnapshot } from '../enrichment.repository';
import { RunnerState } from '../enrichment.runner';

/**
 * Cuerpo del `POST /v1/admin/enrichment/runs`.
 *
 * Los dos campos son opcionales: el pedido normal es un body vacío. El `ValidationPipe`
 * global corre con `whitelist` + `forbidNonWhitelisted`, así que un campo desconocido es
 * **422** y no un valor ignorado en silencio — en una superficie que gasta dinero, un typo
 * como `"forced": true` tiene que ser un error visible y no una corrida que no hace lo que
 * el dueño creyó pedir.
 */
export class StartEnrichmentRunDto {
  /**
   * Devuelve a la cola los productos abandonados (`attempts >= max`) antes de barrer.
   *
   * Es explícito a propósito: si el reintento de los abandonados fuera automático, el tope
   * de intentos no serviría para nada.
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  /**
   * Acota la corrida a estos productos. El tope existe porque cada id de esta lista es una
   * llamada paga al proveedor; para el catálogo entero se manda el body vacío, que va por
   * lotes con su propio control de concurrencia.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  product_ids?: string[];
}

/** Respuesta del 202: lo mínimo para que el panel arranque el polling del `/status`. */
export interface StartEnrichmentRunResponse {
  run_id: string;
  accepted: true;
}

/**
 * Respuesta del `GET /v1/admin/enrichment/status` (AC-3).
 *
 * Lo que **no** está acá es tan deliberado como lo que está: ni la clave del proveedor, ni
 * la URL de la API, ni un mensaje crudo de error. `last_error_code` es un `type` del
 * catálogo (`dsm:enrichment/*`), que es información de diagnóstico sin secretos adentro.
 */
export class EnrichmentStatusResponseDto {
  runner_state!: RunnerState;
  coverage!: CoverageSnapshot;
  models!: { enrich: string; embed: string };
  last_error_code!: string | null;
  last_run_at!: string | null;

  static from(input: {
    runnerState: RunnerState;
    coverage: CoverageSnapshot;
    enrichModel: string;
    embedModel: string;
    lastErrorCode: string | null;
    lastRunAt: Date | null;
  }): EnrichmentStatusResponseDto {
    return {
      runner_state: input.runnerState,
      coverage: input.coverage,
      // El nombre del modelo, no la clave: el panel necesita saber CON QUÉ se generaron los
      // vectores para interpretar la cobertura tras un cambio de modelo (`model_version`).
      models: { enrich: input.enrichModel, embed: input.embedModel },
      last_error_code: input.lastErrorCode,
      last_run_at: input.lastRunAt?.toISOString() ?? null,
    };
  }
}
