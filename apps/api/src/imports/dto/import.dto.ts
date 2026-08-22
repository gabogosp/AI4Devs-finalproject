import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ImportJob, ImportJobRow } from '@dsm/db';

/**
 * Paginación de las filas rechazadas. Mismo contrato que el listado admin de
 * US-001 (`api-standards §6.1`), con dos diferencias deliberadas:
 *
 * - `limit` arranca en **50**: el panel muestra una tabla de errores, no un
 *   listado de catálogo.
 * - `limit` tiene **techo**: sin él, `?limit=100000` sobre un import
 *   íntegramente malo sería un DoS servido por nosotros mismos.
 */
export class ImportJobQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

/** Una fila rechazada, tal como la ve el panel. */
export class ImportRowErrorDto {
  row_number!: number;
  sku!: string | null;
  field!: string | null;
  error_code!: string;
  error_message!: string;

  static from(row: ImportJobRow): ImportRowErrorDto {
    return {
      row_number: row.row_number,
      sku: row.sku,
      field: row.field,
      error_code: row.error_code,
      error_message: row.error_message,
    };
  }
}

/**
 * Estado del trabajo de import (design.md §API).
 *
 * DTO **separado de la entidad** (§4) y esa separación acá no es ceremonia:
 * `import_jobs` tiene dos columnas que no salen nunca —`idempotency_key`, que es
 * una credencial de reintento del cliente, y `heartbeat_at`, que es plumbing del
 * reaper—. Devolver la fila entera las filtraría, y `updated_at` encima le daría
 * al panel dos campos con la misma pinta (`finished_at`) y semántica distinta.
 */
export class ImportJobResponseDto {
  id!: string;
  status!: string;
  filename!: string;
  source_format!: string;
  /** `null` hasta que termina la lectura: el progreso es `processed/total`. */
  total_rows!: number | null;
  processed_rows!: number;
  created_count!: number;
  updated_count!: number;
  failed_count!: number;
  categories_created_count!: number;
  /** Fallo **global** (AC-6). `null` si los fallos fueron por fila. */
  error_code!: string | null;
  error_message!: string | null;
  report_truncated!: boolean;
  started_at!: string | null;
  finished_at!: string | null;
  created_at!: string;
  errors!: ImportRowErrorDto[];
  pagination!: { limit: number; offset: number; total: number };

  static from(
    job: ImportJob,
    errors: ImportJobRow[],
    pagination: { limit: number; offset: number; total: number },
  ): ImportJobResponseDto {
    return {
      id: job.id,
      status: job.status,
      filename: job.filename,
      source_format: job.source_format,
      total_rows: job.total_rows,
      processed_rows: job.processed_rows,
      created_count: job.created_count,
      updated_count: job.updated_count,
      failed_count: job.failed_count,
      categories_created_count: job.categories_created_count,
      error_code: job.error_code,
      error_message: job.error_message,
      report_truncated: job.report_truncated,
      started_at: job.started_at?.toISOString() ?? null,
      finished_at: job.finished_at?.toISOString() ?? null,
      created_at: job.created_at.toISOString(),
      errors: errors.map(ImportRowErrorDto.from),
      pagination,
    };
  }
}
