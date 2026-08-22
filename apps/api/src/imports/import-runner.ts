import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImportFormat } from './detect-format';
import {
  ImportJobsRepository,
  JobCounters,
  RowErrorData,
} from './import-jobs.repository';
import { ImportsService, RowOutcome } from './imports.service';
import { readRows } from './read-rows';
import { ParsedRow, validateRow } from './row-schema';

/**
 * T4.3 — ejecutor del import (ADR-0012).
 *
 * Corre **en el proceso del API** porque Redis todavía no está aprovisionado,
 * pero detrás del **mismo contrato asíncrono** que tendrá con la cola: el
 * request responde 202 y el estado se consulta por `GET`. La durabilidad la da
 * Postgres, no un temporizador — si el proceso muere, el trabajo queda en la
 * base y el reaper lo cierra al arrancar. Cuando llegue BullMQ, esta clase pasa
 * a ser un processor que lee el mismo `import_jobs` y ni el contrato HTTP ni el
 * esquema cambian.
 *
 * Dos disciplinas que no son negociables acá:
 *
 * 1. **No bloquear el event loop** (backend-node-standards §8): se procesa por
 *    lotes con un `await` que cede el turno entre lotes. Un import de 5.000
 *    filas que ocupara el loop dejaría al storefront sin responder.
 * 2. **El trabajo siempre se cierra**: el `finally` garantiza que ningún job
 *    quede `running` para siempre, porque un `running` fantasma bloquea todos
 *    los imports siguientes con un 409 que el dueño no puede resolver.
 */
@Injectable()
export class ImportRunner implements OnApplicationBootstrap {
  private readonly logger = new Logger(ImportRunner.name);

  private readonly batchSize: number;
  private readonly maxRows: number;
  private readonly maxUncompressedBytes: number;
  private readonly maxReportRows: number;
  private readonly staleMs: number;
  private readonly retentionDays: number;

  constructor(
    private readonly jobs: ImportJobsRepository,
    private readonly imports: ImportsService,
    config: ConfigService,
  ) {
    this.batchSize = config.get<number>('IMPORT_BATCH_SIZE') ?? 200;
    this.maxRows = config.get<number>('IMPORT_MAX_ROWS') ?? 5_000;
    this.maxUncompressedBytes =
      config.get<number>('IMPORT_MAX_UNCOMPRESSED_BYTES') ?? 33_554_432;
    this.maxReportRows = config.get<number>('IMPORT_MAX_REPORT_ROWS') ?? 1_000;
    this.staleMs = config.get<number>('IMPORT_JOB_STALE_MS') ?? 120_000;
    this.retentionDays = config.get<number>('IMPORT_RETENTION_DAYS') ?? 90;
  }

  /**
   * Al arrancar: cerrar los trabajos huérfanos y purgar el historial vencido.
   *
   * Es el precio del ejecutor in-process: un redeploy mata el runner en la mitad
   * del trabajo. Sin este barrido, el `running` que quedó en la base bloquearía
   * el próximo import y nadie sabría por qué.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const cerrados = await this.jobs.reapStale(this.staleMs);
      if (cerrados > 0) {
        this.logger.warn(
          `import: ${cerrados} trabajo(s) huérfano(s) cerrados como interrupted`,
        );
      }
      // Purga oportunista (OQ-BE-6): sin cron, el arranque es el único momento
      // garantizado. Es best-effort a propósito: que la retención falle no puede
      // impedir que la API levante.
      await this.jobs.purgeOlderThan(this.retentionDays);
    } catch (error) {
      this.logger.error(
        `import: falló el barrido de arranque: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Dispara el trabajo y devuelve el control **en el acto**: el `POST` ya
   * respondió 202 y no espera nada de esto (AC-7).
   */
  schedule(jobId: string, buffer: Buffer, format: ImportFormat): void {
    setImmediate(() => {
      void this.run(jobId, buffer, format);
    });
  }

  /**
   * Procesa el archivo completo. No lanza: cualquier fallo global queda en el
   * trabajo como `failed` con su `error_code`.
   */
  async run(
    jobId: string,
    buffer: Buffer,
    format: ImportFormat,
  ): Promise<void> {
    const contadores: JobCounters = {
      processedRows: 0,
      createdCount: 0,
      updatedCount: 0,
      failedCount: 0,
      categoriesCreatedCount: 0,
    };
    const ctx = this.imports.createContext();
    const idsParaEnriquecer: string[] = [];
    let erroresPersistidos = 0;
    let reportTruncated = false;
    let cerrado = false;

    try {
      await this.jobs.markRunning(jobId);

      let lote: ParsedRow[] = [];
      const erroresDelLote: RowErrorData[] = [];

      const flush = async (): Promise<void> => {
        if (lote.length > 0) {
          const resultados = await this.imports.processBatch(ctx, lote);
          for (const r of resultados) {
            this.acumular(r, contadores, idsParaEnriquecer, erroresDelLote);
          }
          lote = [];
        }
        contadores.categoriesCreatedCount = ctx.categoriesCreated;

        const guardadas = await this.persistirErrores(
          jobId,
          erroresDelLote,
          erroresPersistidos,
        );
        erroresPersistidos += guardadas.persistidas;
        reportTruncated = reportTruncated || guardadas.truncado;
        erroresDelLote.length = 0;

        await this.jobs.heartbeat(jobId, { ...contadores, reportTruncated });
        // Cede el turno: sin esto, 5.000 filas serían una sola tarea del event
        // loop y la API entera quedaría muda mientras corre.
        await new Promise<void>((resolve) => setImmediate(resolve));
      };

      for await (const fila of readRows(buffer, format, {
        maxRows: this.maxRows,
        maxUncompressedBytes: this.maxUncompressedBytes,
      })) {
        contadores.processedRows += 1;
        const resultado = validateRow(fila.cells, fila.rowNumber);

        if (resultado.kind === 'error') {
          contadores.failedCount += 1;
          erroresDelLote.push({
            rowNumber: resultado.rowNumber,
            sku: resultado.sku,
            field: resultado.field,
            errorCode: resultado.errorCode,
            errorMessage: resultado.errorMessage,
          });
        } else {
          lote.push(resultado);
        }

        if (lote.length >= this.batchSize) await flush();
      }

      await flush();

      // `total_rows` recién se conoce cuando terminó la lectura: hasta entonces,
      // publicar un total sería inventarlo.
      contadores.totalRows = contadores.processedRows;
      await this.jobs.markCompleted(jobId, { ...contadores, reportTruncated });
      cerrado = true;

      this.notificarEnriquecimiento(idsParaEnriquecer);
    } catch (error) {
      const code = this.codigoDeFalloGlobal(error);
      await this.jobs
        .markFailed(jobId, code, (error as Error).message)
        .catch(() => undefined);
      cerrado = true;
      this.logger.error(
        `import ${jobId}: fallo global (${code}): ${(error as Error).message}`,
      );
    } finally {
      if (!cerrado) {
        // Cinturón y tirantes: si el cierre de arriba no ocurrió por cualquier
        // motivo, el trabajo NO se queda `running` bloqueando los siguientes.
        await this.jobs
          .markFailed(jobId, 'interrupted', 'El import terminó de forma inesperada')
          .catch(() => undefined);
      }
    }
  }

  /**
   * Punto de inyección de la cola de enriquecimiento (AC-3). En T4.4 pasa a
   * delegar en el puerto `EnrichmentQueue`; hasta entonces la marca durable
   * `products.enrichment_done = false` ya quedó en la base, así que la cola se
   * puede reconstruir con un `SELECT`.
   */
  protected notificarEnriquecimiento(ids: string[]): void {
    if (ids.length > 0) {
      this.logger.log(`import: ${ids.length} producto(s) pendientes de enriquecer`);
    }
  }

  private acumular(
    resultado: RowOutcome,
    contadores: JobCounters,
    idsParaEnriquecer: string[],
    errores: RowErrorData[],
  ): void {
    if (resultado.kind === 'error') {
      contadores.failedCount += 1;
      errores.push({
        rowNumber: resultado.rowNumber,
        sku: resultado.sku,
        field: resultado.field,
        errorCode: resultado.errorCode,
        errorMessage: resultado.errorMessage,
      });
      return;
    }
    if (resultado.kind === 'created') contadores.createdCount += 1;
    else contadores.updatedCount += 1;
    if (resultado.enrichmentPending) idsParaEnriquecer.push(resultado.id);
  }

  /**
   * Persiste filas rechazadas hasta el tope. Superado, se deja de escribir y se
   * marca `report_truncated`: `failed_count` sigue contando **el total real**, así
   * que el contador no miente aunque el reporte esté recortado. Un archivo
   * íntegramente malo no puede convertir el reporte en un segundo problema de
   * almacenamiento.
   */
  private async persistirErrores(
    jobId: string,
    errores: RowErrorData[],
    yaPersistidos: number,
  ): Promise<{ persistidas: number; truncado: boolean }> {
    if (errores.length === 0) return { persistidas: 0, truncado: false };
    const espacio = this.maxReportRows - yaPersistidos;
    if (espacio <= 0) return { persistidas: 0, truncado: true };

    const aGuardar = errores.slice(0, espacio);
    await this.jobs.appendRowErrors(jobId, aGuardar);
    return {
      persistidas: aGuardar.length,
      truncado: errores.length > espacio,
    };
  }

  /** Traduce el fallo global al `error_code` que verá el dueño. */
  private codigoDeFalloGlobal(error: unknown): string {
    const tipo = (error as { type?: string }).type;
    if (typeof tipo === 'string' && tipo.startsWith('dsm:import/')) {
      return tipo.slice('dsm:import/'.length);
    }
    return 'internal';
  }
}
