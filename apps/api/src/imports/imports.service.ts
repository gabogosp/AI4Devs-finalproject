import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImportJob, ImportJobRow } from '@dsm/db';
import { CategoriesRepository } from '../categories/categories.repository';
import {
  ImportProductRef,
  ProductsRepository,
} from '../products/products.repository';
import {
  ConflictError,
  ValidationError,
} from '../common/errors/domain-errors';
import { slugify } from '../common/slug';
import { BatchSlugAllocator } from './batch-slug-allocator';
import { CategoryResolver } from './category-resolver';
import { detectFormat, ImportFormat } from './detect-format';
import { ImportJobsRepository } from './import-jobs.repository';
import {
  FileTooLargeError,
  ImportAlreadyRunningError,
  ImportNotFoundError,
} from './import-errors';
import { readRows } from './read-rows';
import {
  faltantesParaAlta,
  ParsedRow,
  RowError,
  RowErrorCode,
} from './row-schema';

/** Resultado de preparar un import: el trabajo listo para encolar (o su réplica). */
export interface PreparedImport {
  job: ImportJob;
  format: ImportFormat;
  /** `true` si la `Idempotency-Key` ya tenía un trabajo: no se creó nada nuevo. */
  replayed: boolean;
}

/**
 * Resultado de procesar una fila: se escribió (y qué pasó) o se rechazó.
 * El runner suma los contadores con esto y persiste sólo los errores.
 */
export type RowOutcome =
  | { kind: 'created'; id: string; sku: string; enrichmentPending: true }
  | { kind: 'updated'; id: string; sku: string; enrichmentPending: boolean }
  | RowError;

/**
 * Estado que vive **todo el trabajo**, no un lote: el allocator de slugs, el
 * resolver de categorías y los SKUs ya vistos. Que esto sea explícito y no
 * estado del service es lo que permite que el service siga siendo un singleton
 * de Nest mientras cada import tiene su propia memoria.
 */
export class ImportContext {
  readonly vistos = new Set<string>();

  constructor(
    readonly allocator: BatchSlugAllocator,
    readonly resolver: CategoryResolver,
  ) {}

  get categoriesCreated(): number {
    return this.resolver.categoriesCreated;
  }
}

@Injectable()
export class ImportsService {
  private readonly maxFileBytes: number;
  private readonly maxRows: number;
  private readonly maxUncompressedBytes: number;

  constructor(
    private readonly products: ProductsRepository,
    private readonly categories: CategoriesRepository,
    private readonly jobs: ImportJobsRepository,
    config: ConfigService,
  ) {
    this.maxFileBytes = config.get<number>('IMPORT_MAX_FILE_BYTES') ?? 4_194_304;
    this.maxRows = config.get<number>('IMPORT_MAX_ROWS') ?? 5_000;
    this.maxUncompressedBytes =
      config.get<number>('IMPORT_MAX_UNCOMPRESSED_BYTES') ?? 33_554_432;
  }

  /**
   * Valida el archivo y crea el trabajo, **en ese orden** (AC-6): formato,
   * encoding, encabezados y tope de filas se resuelven antes de escribir nada,
   * así un archivo que no sirve devuelve 4xx y deja el catálogo —y la tabla de
   * trabajos— exactamente como estaban.
   *
   * No procesa: encolar el trabajo es del llamador, después del 202 (AC-7).
   */
  async prepareImport(input: {
    buffer: Buffer;
    filename: string;
    idempotencyKey?: string;
    subject?: string;
  }): Promise<PreparedImport> {
    // 1. Reintento con la misma clave: se devuelve el trabajo original sin crear
    //    otro (api-standards §10). Un doble click del panel no dispara dos
    //    imports del mismo archivo.
    if (input.idempotencyKey) {
      const previo = await this.jobs.findByIdempotencyKey(input.idempotencyKey);
      if (previo !== null) {
        return {
          job: previo,
          format: previo.source_format as ImportFormat,
          replayed: true,
        };
      }
    }

    // 2. El cap de tamaño, otra vez. El borde HTTP ya lo aplica en el multipart;
    //    esto cubre cualquier otro camino de entrada (defensa en profundidad).
    if (input.buffer.length > this.maxFileBytes) {
      throw new FileTooLargeError(this.maxFileBytes);
    }

    // 3. Un solo trabajo vigente (ADR-0012). Se chequea antes de gastar tiempo
    //    en parsear un archivo que no se va a procesar igual.
    if ((await this.jobs.findActive()) !== null) {
      throw new ImportAlreadyRunningError();
    }

    // 4. Formato por contenido y validación del archivo completo. Lanza 415/422
    //    sin haber tocado la base.
    const format = detectFormat(input.buffer, input.filename);
    await this.preflight(input.buffer, format);

    try {
      const job = await this.jobs.create({
        filename: input.filename,
        fileSizeBytes: input.buffer.length,
        sourceFormat: format,
        idempotencyKey: input.idempotencyKey,
        createdBySubject: input.subject,
      });
      return { job, format, replayed: false };
    } catch (error) {
      // Carrera de dos requests con la misma clave: gana el primero y el segundo
      // devuelve su trabajo, que es lo mismo que hubiera pasado secuencialmente.
      if (error instanceof ConflictError && input.idempotencyKey) {
        const ganador = await this.jobs.findByIdempotencyKey(
          input.idempotencyKey,
        );
        if (ganador !== null) {
          return {
            job: ganador,
            format: ganador.source_format as ImportFormat,
            replayed: true,
          };
        }
      }
      throw error;
    }
  }

  /**
   * Recorre el archivo para validar encabezados y tope de filas antes de crear
   * el trabajo. Se descarta lo leído: procesar es del runner.
   *
   * Sí, el archivo se lee dos veces. Es el precio de AC-6 —"formato o columnas
   * inválidas ⇒ 4xx sin crear el trabajo"—, y está acotado por el cap de tamaño:
   * la alternativa sería crear un trabajo que nace `failed`, y entonces el panel
   * tendría que explicarle al dueño un import que nunca existió.
   */
  private async preflight(buffer: Buffer, format: ImportFormat): Promise<void> {
    for await (const fila of readRows(buffer, format, {
      maxRows: this.maxRows,
      maxUncompressedBytes: this.maxUncompressedBytes,
    })) {
      void fila;
    }
  }

  /**
   * Estado del trabajo con sus filas rechazadas paginadas (AC-5, AC-7).
   *
   * Un id inexistente es 404 y no un cuerpo vacío: el panel hace polling y tiene
   * que poder distinguir "todavía no hay progreso" de "este trabajo no existe"
   * (por ejemplo, porque la retención de 90 días ya se lo llevó).
   */
  async getJob(
    id: string,
    page: { limit: number; offset: number },
  ): Promise<{
    job: ImportJob;
    errors: ImportJobRow[];
    total: number;
  }> {
    const job = await this.jobs.findById(id);
    if (job === null) throw new ImportNotFoundError();

    const [errors, total] = await Promise.all([
      this.jobs.findRowErrors(id, page),
      this.jobs.countRowErrors(id),
    ]);
    return { job, errors, total };
  }

  /**
   * Filas rechazadas COMPLETAS para el reporte descargable, sin paginar: el
   * archivo se abre en una planilla y un reporte partido en páginas no sirve para
   * arreglar el catálogo. El tope de persistencia (`IMPORT_MAX_REPORT_ROWS`) es lo
   * que acota su tamaño.
   */
  async getReport(
    id: string,
  ): Promise<{ job: ImportJob; rows: ImportJobRow[] }> {
    const job = await this.jobs.findById(id);
    if (job === null) throw new ImportNotFoundError();
    return { job, rows: await this.jobs.findAllRowErrors(id) };
  }

  createContext(): ImportContext {
    return new ImportContext(
      new BatchSlugAllocator(this.products),
      new CategoryResolver(this.categories),
    );
  }

  /**
   * Procesa un lote: **tres** consultas de preparación (productos por SKU,
   * categorías del lote, slugs del lote) y después una transacción por fila.
   *
   * La atomicidad es por fila y no por lote a propósito (AC-5): una fila mala en
   * la posición 3.000 no puede tirar abajo las 2.999 buenas que ya se
   * escribieron. El dueño quiere que entre lo que sirve y que le digan qué no.
   */
  async processBatch(
    ctx: ImportContext,
    filas: ParsedRow[],
  ): Promise<RowOutcome[]> {
    if (filas.length === 0) return [];

    const existentes = await this.products.findManyBySkus(
      filas.map((f) => f.sku),
    );
    // Sólo se resuelven las categorías que el archivo nombra: una fila que dejó
    // la celda vacía sobre un SKU existente conserva su categoría (OQ-BE-2).
    const categorias = await ctx.resolver.resolve(
      filas
        .map((f) => f.categoryName)
        .filter((c): c is string => c !== undefined),
    );

    // Sólo las bases de los SKUs nuevos: para los existentes no se recalcula el
    // slug (regla de US-003), así que no hace falta saber qué hay tomado.
    const basesNuevas = filas
      .filter((f) => !existentes.has(f.sku))
      .map((f) => this.baseSlug(f))
      .filter((b): b is string => b !== null);
    await ctx.allocator.prime(basesNuevas);

    const resultados: RowOutcome[] = [];
    for (const fila of filas) {
      resultados.push(
        await this.processRow(ctx, fila, existentes.get(fila.sku), categorias),
      );
    }
    return resultados;
  }

  /**
   * Escribe una fila válida, o devuelve el motivo por el que no se pudo.
   *
   * Nunca lanza: un fallo de escritura de una fila es un dato del reporte, no
   * una excepción del trabajo.
   */
  async processRow(
    ctx: ImportContext,
    fila: ParsedRow,
    existente: ImportProductRef | undefined,
    categorias: Map<string, string>,
  ): Promise<RowOutcome> {
    if (ctx.vistos.has(fila.sku)) {
      // No es "gana el último" silencioso: es un error de datos del operador y
      // merece aparecer en el reporte (design §Reconciliación).
      return this.error(
        fila,
        'sku',
        'duplicate_sku_in_file',
        'el sku aparece más de una vez en el archivo; se procesó la primera aparición',
      );
    }
    ctx.vistos.add(fila.sku);

    // Acá —y sólo acá— se sabe si la fila es un alta o una actualización, que es
    // lo que decide si una celda vacía es una omisión o una instrucción.
    //
    // En un alta faltan datos obligatorios ⇒ fila inválida. En una actualización,
    // cada ausencia significa "no toques este campo" (OQ-BE-2 + decisión del PO
    // del 2026-08-22, OQ-8): es lo que hace posible el archivo de ajuste de
    // precios sin repetir el stock y la categoría de cada producto.
    if (!existente) {
      const faltantes = faltantesParaAlta(fila);
      if (faltantes.length > 0) {
        return this.error(
          fila,
          faltantes[0],
          'missing_required',
          `para dar de alta un producto nuevo hacen falta: ${faltantes.join(', ')}`,
        );
      }
    }

    // La categoría sólo se resuelve si el archivo la nombró; si no, el producto
    // existente conserva la que tiene.
    let categoryId: string | undefined;
    if (fila.categoryName !== undefined) {
      categoryId = categorias.get(fila.categoryName);
      if (categoryId === undefined) {
        return this.error(
          fila,
          'categoria',
          'invalid_category',
          'la categoría no se pudo resolver ni crear',
        );
      }
    }

    const base = this.baseSlug(fila);
    if (!existente && base === null) {
      return this.error(
        fila,
        'nombre',
        'invalid_text',
        'el nombre no permite derivar una URL amigable',
      );
    }

    // Para un SKU existente el slug propuesto es irrelevante (no se recalcula),
    // pero se manda el persistido para que el dato que viaja sea el verdadero.
    const slug = existente
      ? existente.slug
      : ctx.allocator.allocate(base as string);

    try {
      return this.aOutcome(
        await this.escribir(fila, slug, categoryId),
        fila,
        existente,
      );
    } catch (error) {
      if (this.esColisionDeSlug(error) && !existente) {
        // Un reintento, con el set refrescado: la colisión significa que la base
        // tiene un slug que el allocator no conocía. Reintentar con el mismo set
        // sería repetir el error.
        try {
          await ctx.allocator.refresh([base as string]);
          return this.aOutcome(
            await this.escribir(
              fila,
              ctx.allocator.allocate(base as string),
              categoryId,
            ),
            fila,
            existente,
          );
        } catch (segundo) {
          if (this.esColisionDeSlug(segundo)) {
            return this.error(
              fila,
              'nombre',
              'slug_conflict',
              'no se pudo generar una URL única para este producto',
            );
          }
          return this.errorDeEscritura(fila);
        }
      }
      if (this.esColisionDeSlug(error)) {
        return this.error(
          fila,
          'nombre',
          'slug_conflict',
          'no se pudo generar una URL única para este producto',
        );
      }
      if (this.esCategoriaInexistente(error) && fila.categoryName !== undefined) {
        // La categoría desapareció entre la resolución y la escritura. Se olvida
        // del cache para que las filas siguientes del mismo rubro la vuelvan a
        // resolver: el borrado cuesta esta fila, no el resto del trabajo.
        ctx.resolver.invalidate(fila.categoryName);
      }
      return this.errorDeEscritura(fila);
    }
  }

  private escribir(
    fila: ParsedRow,
    slug: string,
    categoryId: string | undefined,
  ) {
    return this.products.upsertFromImport({
      sku: fila.sku,
      slug,
      name: fila.name,
      descriptionRaw: fila.descriptionRaw,
      priceArsCents: fila.priceArsCents,
      stock: fila.stock,
      categoryId,
      imageUrl: fila.imageUrl,
    });
  }

  private aOutcome(
    resultado: { outcome: 'created' | 'updated'; id: string },
    fila: ParsedRow,
    existente: ImportProductRef | undefined,
  ): RowOutcome {
    if (resultado.outcome === 'created') {
      return {
        kind: 'created',
        id: resultado.id,
        sku: fila.sku,
        enrichmentPending: true,
      };
    }
    // Sólo hay que re-enriquecer si cambió la descripción base (E2E §9.3): un
    // update de precio o stock no cambia lo que el modelo tendría que leer.
    const cambioDescripcion =
      fila.descriptionRaw !== undefined &&
      fila.descriptionRaw !== (existente?.description_raw ?? null);
    return {
      kind: 'updated',
      id: resultado.id,
      sku: fila.sku,
      enrichmentPending: cambioDescripcion,
    };
  }

  /**
   * Base del slug para un **alta**. `null` si ni el nombre ni el sku producen una
   * base usable; en una actualización no se usa (el slug persistido no se toca).
   */
  private baseSlug(fila: ParsedRow): string | null {
    // Mismo criterio que el alta de a uno (US-003): el `sku` es el fallback.
    return slugify(fila.name ?? '') || slugify(fila.sku) || null;
  }

  private esColisionDeSlug(error: unknown): boolean {
    return (
      error instanceof ConflictError &&
      (error.fieldErrors ?? []).some((f) => f.field === 'slug')
    );
  }

  /** La FK de categoría no resolvió: el repositorio traduce el P2003 a esto. */
  private esCategoriaInexistente(error: unknown): boolean {
    return (
      error instanceof ValidationError &&
      (error.fieldErrors ?? []).some((f) => f.field === 'category_id')
    );
  }

  private errorDeEscritura(fila: ParsedRow): RowError {
    // El motivo es deliberadamente genérico: el detalle del fallo va al log del
    // servidor, no al reporte que descarga el dueño. Un mensaje de Prisma le
    // filtraría nombres de tablas y columnas de la base.
    return this.error(
      fila,
      'sku',
      'write_failed',
      'no se pudo guardar esta fila; volvé a intentarlo',
    );
  }

  private error(
    fila: ParsedRow,
    field: string,
    errorCode: RowErrorCode,
    errorMessage: string,
  ): RowError {
    return {
      kind: 'error',
      rowNumber: fila.rowNumber,
      sku: fila.sku,
      field,
      errorCode,
      errorMessage,
    };
  }
}
