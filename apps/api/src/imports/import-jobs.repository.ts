import { Injectable } from '@nestjs/common';
import { ImportJob, ImportJobRow } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictError } from '../common/errors/domain-errors';
import {
  isPrismaError,
  PRISMA_UNIQUE_VIOLATION,
} from '../common/prisma-errors';
import { RowErrorCode } from './row-schema';

/**
 * Único punto de ORM de `import_jobs` e `import_job_rows` (§5).
 *
 * Es lo que hace que el contrato asíncrono de ADR-0012 no dependa de una cola:
 * el estado del trabajo vive en Postgres, así que el progreso es consultable
 * desde cualquier instancia y **sobrevive a un reinicio del proceso** — que con
 * el ejecutor in-process es un evento normal (un redeploy de Railway), no una
 * catástrofe.
 */

export type ImportJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface CreateImportJobData {
  filename: string;
  fileSizeBytes: number;
  sourceFormat: 'csv' | 'xlsx';
  idempotencyKey?: string;
  createdBySubject?: string;
}

/** Contadores publicados a cada latido y al cierre. */
export interface JobCounters {
  processedRows: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  categoriesCreatedCount: number;
  /** Se conoce al terminar de leer el archivo, no al empezar. */
  totalRows?: number;
  reportTruncated?: boolean;
}

export interface RowErrorData {
  rowNumber: number;
  sku?: string;
  field?: string;
  errorCode: RowErrorCode | 'interrupted';
  errorMessage: string;
}

export interface Pagination {
  limit: number;
  offset: number;
}

/** Estados en los que un trabajo ocupa el turno del ejecutor (un solo trabajo a la vez). */
const ESTADOS_VIGENTES: ImportJobStatus[] = ['pending', 'running'];

@Injectable()
export class ImportJobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateImportJobData): Promise<ImportJob> {
    try {
      return await this.prisma.importJob.create({
        data: {
          filename: data.filename,
          file_size_bytes: data.fileSizeBytes,
          source_format: data.sourceFormat,
          idempotency_key: data.idempotencyKey ?? null,
          created_by_subject: data.createdBySubject ?? null,
        },
      });
    } catch (error) {
      // Nunca escapa un error crudo del ORM (§6): el borde HTTP no tiene por qué
      // saber qué es un P2002.
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new ConflictError('Ese import ya fue creado', [
          { field: 'Idempotency-Key', message: 'clave de idempotencia repetida' },
        ]);
      }
      throw error;
    }
  }

  findById(id: string): Promise<ImportJob | null> {
    return this.prisma.importJob.findUnique({ where: { id } });
  }

  findByIdempotencyKey(key: string): Promise<ImportJob | null> {
    return this.prisma.importJob.findUnique({ where: { idempotency_key: key } });
  }

  /**
   * El trabajo vigente (`pending` o `running`), o `null`. Es la base del 409 de
   * "ya hay un import corriendo": con un solo ejecutor in-process, dos trabajos
   * simultáneos competirían por el mismo catálogo.
   */
  findActive(): Promise<ImportJob | null> {
    return this.prisma.importJob.findFirst({
      where: { status: { in: ESTADOS_VIGENTES } },
      orderBy: { created_at: 'asc' },
    });
  }

  markRunning(id: string): Promise<ImportJob> {
    const ahora = new Date();
    return this.prisma.importJob.update({
      where: { id },
      data: { status: 'running', started_at: ahora, heartbeat_at: ahora },
    });
  }

  /**
   * Publica el progreso y renueva el latido. Se llama entre lotes: es lo que
   * hace que `GET` devuelva progreso real mientras el trabajo corre (AC-7) y lo
   * que le permite al reaper distinguir "lento" de "muerto".
   */
  heartbeat(id: string, counters: JobCounters): Promise<ImportJob> {
    return this.prisma.importJob.update({
      where: { id },
      data: { ...this.contadores(counters), heartbeat_at: new Date() },
    });
  }

  markCompleted(id: string, counters: JobCounters): Promise<ImportJob> {
    return this.prisma.importJob.update({
      where: { id },
      data: {
        ...this.contadores(counters),
        status: 'completed',
        finished_at: new Date(),
      },
    });
  }

  markFailed(
    id: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<ImportJob> {
    return this.prisma.importJob.update({
      where: { id },
      data: {
        status: 'failed',
        error_code: errorCode,
        error_message: errorMessage,
        finished_at: new Date(),
      },
    });
  }

  /** Persiste filas rechazadas. El tope lo decide el runner, no el repositorio. */
  async appendRowErrors(id: string, rows: RowErrorData[]): Promise<number> {
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.importJobRow.createMany({
      data: rows.map((r) => ({
        job_id: id,
        row_number: r.rowNumber,
        sku: r.sku ?? null,
        field: r.field ?? null,
        error_code: r.errorCode,
        error_message: r.errorMessage,
      })),
    });
    return count;
  }

  findRowErrors(id: string, page: Pagination): Promise<ImportJobRow[]> {
    return this.prisma.importJobRow.findMany({
      where: { job_id: id },
      orderBy: { row_number: 'asc' },
      take: page.limit,
      skip: page.offset,
    });
  }

  countRowErrors(id: string): Promise<number> {
    return this.prisma.importJobRow.count({ where: { job_id: id } });
  }

  /** Todas las filas rechazadas, ordenadas — insumo del CSV del reporte. */
  findAllRowErrors(id: string): Promise<ImportJobRow[]> {
    return this.prisma.importJobRow.findMany({
      where: { job_id: id },
      orderBy: { row_number: 'asc' },
    });
  }

  /**
   * Cierra los trabajos `running` sin latido reciente: quedaron huérfanos porque
   * el proceso que los ejecutaba se murió (ADR-0012). Sin esto, un redeploy
   * dejaría un `running` eterno que bloquearía todos los imports siguientes con
   * un 409 que el dueño no puede resolver.
   *
   * @returns cuántos trabajos cerró.
   */
  async reapStale(staleMs: number): Promise<number> {
    const corte = new Date(Date.now() - staleMs);
    const { count } = await this.prisma.importJob.updateMany({
      where: { status: 'running', heartbeat_at: { lt: corte } },
      data: {
        status: 'failed',
        error_code: 'interrupted',
        error_message:
          'El import se interrumpió (el proceso se reinició). Volvé a subir el archivo: la reconciliación por SKU lo hace seguro.',
        finished_at: new Date(),
      },
    });
    return count;
  }

  /**
   * Purga los trabajos fuera de la ventana de retención (OQ-BE-6: 90 días). La
   * cascada de la FK se lleva sus filas de error.
   *
   * El guard de `days > 0` no es paranoia: `purgeOlderThan(0)` borraría el
   * historial entero, incluido el trabajo que está corriendo.
   */
  async purgeOlderThan(days: number): Promise<number> {
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error(
        `purgeOlderThan requiere una ventana positiva; recibió ${days}`,
      );
    }
    const corte = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.importJob.deleteMany({
      where: { created_at: { lt: corte } },
    });
    return count;
  }

  private contadores(c: JobCounters) {
    return {
      processed_rows: c.processedRows,
      created_count: c.createdCount,
      updated_count: c.updatedCount,
      failed_count: c.failedCount,
      categories_created_count: c.categoriesCreatedCount,
      ...(c.totalRows !== undefined ? { total_rows: c.totalRows } : {}),
      ...(c.reportTruncated !== undefined
        ? { report_truncated: c.reportTruncated }
        : {}),
    };
  }
}
