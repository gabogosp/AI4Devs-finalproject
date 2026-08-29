import { ConfigService } from '@nestjs/config';

/**
 * Config stub de la superficie de import para los tests que instancian el
 * service o el runner a mano (sin contenedor de Nest).
 *
 * Los defaults son los **reales** de `env.validation.ts`, salvo el lote, que se
 * baja a 50 para que un test de progreso tenga varios lotes sin generar miles de
 * filas. Cada test sobreescribe lo que necesita apretar.
 */
export const IMPORT_LIMITES_DE_TEST: Record<string, number> = {
  IMPORT_MAX_FILE_BYTES: 4_194_304,
  IMPORT_MAX_ROWS: 5_000,
  IMPORT_MAX_UNCOMPRESSED_BYTES: 33_554_432,
  IMPORT_BATCH_SIZE: 50,
  IMPORT_MAX_REPORT_ROWS: 1_000,
  IMPORT_JOB_STALE_MS: 120_000,
  IMPORT_RETENTION_DAYS: 90,
  IMPORT_RATE_LIMIT_MAX: 3,
  IMPORT_RATE_LIMIT_TTL_MS: 3_600_000,
};

export function importConfigStub(
  over: Record<string, number> = {},
): ConfigService {
  const valores = { ...IMPORT_LIMITES_DE_TEST, ...over };
  return {
    get: <T>(clave: string): T => valores[clave] as unknown as T,
  } as ConfigService;
}
