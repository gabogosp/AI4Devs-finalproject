import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_EMBEDDER,
  AI_ENRICHER,
  AiEmbedder,
  AiEnricher,
} from './ports/ai.ports';
import { ClaimedProduct, EnrichmentRepository } from './enrichment.repository';
import { buildSourceText, hashSourceText, SourceTextInput } from './source-text';

/** Qué hizo el pipeline con un producto. Es lo que el runner agrega para el `/status`. */
export type ProcessOutcome =
  | 'enriched_and_embedded'
  | 'embedded_from_curated'
  | 'embedded_only'
  | 'skipped_unchanged';

/**
 * Caso de uso del enriquecimiento por producto (US-005 T3.2).
 *
 * Acá vive la **matriz de decisión** del `design.md`, que es donde AC-6 (no gastar dos veces
 * por lo mismo) y AC-7 (la IA no pisa el texto del dueño) dejan de ser intenciones y se
 * vuelven código. Las dos preguntas que deciden todo son: ¿el texto es curado? y ¿cambió el
 * hash del texto fuente?
 *
 * | Estado | LLM | Embedder | Resultado |
 * |---|---|---|---|
 * | Nuevo o texto base cambiado, no curado | sí | sí | `enriched_and_embedded` |
 * | Curado, texto cambiado | **no** (AC-7) | sí | `embedded_from_curated` |
 * | Hash igual y con embedding | no | no | `skipped_unchanged` (AC-6) |
 * | Hash igual y **sin** embedding | no | sí | `embedded_only` |
 * | Sin descripción y sin curar | sí | sí | `enriched_and_embedded` |
 */
@Injectable()
export class EnrichmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: EnrichmentRepository,
    private readonly config: ConfigService,
    @Inject(AI_ENRICHER) private readonly enricher: AiEnricher,
    @Inject(AI_EMBEDDER) private readonly embedder: AiEmbedder,
  ) {}

  /**
   * Procesa un producto arrendado.
   *
   * Lanza si el proveedor falla: el manejo del fallo (intentos, backoff durable, abandono)
   * es de `registerFailure`, para que el camino feliz quede legible y el de error no se
   * mezcle con la matriz.
   */
  async processProduct(
    producto: ClaimedProduct,
    categoryName: string,
  ): Promise<ProcessOutcome> {
    const insumos: SourceTextInput = {
      name: producto.name,
      categoryName,
      curated: producto.description_curated ? producto.description_enriched : null,
      enriched: producto.description_curated ? null : producto.description_enriched,
      raw: producto.description_raw,
    };

    const hashActual = hashSourceText(insumos);
    const sinCambios = hashActual === producto.enrichment_source_hash;

    // Fila 3 y 4 de la matriz: el texto no cambió. La única pregunta que queda es si el
    // vector existe — si falló una corrida anterior, se completa sin volver a pagar el LLM.
    if (sinCambios) {
      if (await this.repo.hasEmbedding(producto.id)) {
        await this.marcarHecho(producto.id, null, hashActual);
        return 'skipped_unchanged';
      }
      const vector = await this.embedder.embed(buildSourceText(insumos));
      await this.persistir(producto.id, null, hashActual, vector);
      return 'embedded_only';
    }

    // Fila 2: texto curado por el dueño. La IA **no** lo reescribe (AC-7), pero el
    // embedding sí se regenera, porque el texto que hay que poder buscar es el nuevo.
    if (producto.description_curated) {
      const vector = await this.embedder.embed(buildSourceText(insumos));
      await this.persistir(producto.id, null, hashActual, vector);
      return 'embedded_from_curated';
    }

    // Filas 1 y 5: hay que escribir texto. El embedding se calcula sobre el texto
    // enriquecido recién generado, no sobre el viejo.
    const enriquecido = await this.enricher.enrich({
      name: producto.name,
      categoryName,
      baseText: producto.description_raw,
    });
    const conTextoNuevo: SourceTextInput = { ...insumos, enriched: enriquecido };
    const vector = await this.embedder.embed(buildSourceText(conTextoNuevo));
    await this.persistir(
      producto.id,
      enriquecido,
      hashSourceText(conTextoNuevo),
      vector,
    );
    return 'enriched_and_embedded';
  }

  /**
   * Escribe el resultado en **una transacción corta**: el texto y el vector entran juntos o
   * no entra ninguno. Sin esto, un fallo del embedder dejaría `description_enriched` escrita
   * y sin vector, y el hash actualizado haría que la próxima corrida lo saltee como
   * «sin cambios» — un producto enriquecido que nunca se puede buscar.
   */
  private async persistir(
    productId: string,
    enriquecido: string | null,
    hash: string,
    vector: number[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.actualizarProducto(tx, productId, enriquecido, hash);
      const literal = `[${vector.join(',')}]`;
      await tx.$executeRaw`
        INSERT INTO product_embeddings (product_id, embedding, model_version, generated_at)
        VALUES (${productId}::uuid, ${literal}::vector, ${this.embedder.modelVersion}, now())
        ON CONFLICT (product_id) DO UPDATE
           SET embedding = EXCLUDED.embedding,
               model_version = EXCLUDED.model_version,
               generated_at = now()`;
    });
  }

  /** Marca hecho sin tocar el vector (caso `skipped_unchanged`). */
  private async marcarHecho(
    productId: string,
    enriquecido: string | null,
    hash: string,
  ): Promise<void> {
    await this.actualizarProducto(this.prisma, productId, enriquecido, hash);
  }

  /**
   * `UPDATE` con columnas **enumeradas**, y `status` deliberadamente ausente de la lista
   * (AC-10): el enriquecimiento nunca publica ni despublica un producto. Que la columna no
   * esté en el SQL es lo que lo hace imposible, en vez de depender de que nadie la agregue.
   */
  private async actualizarProducto(
    client: Pick<PrismaService, '$executeRaw'>,
    productId: string,
    enriquecido: string | null,
    hash: string,
  ): Promise<void> {
    if (enriquecido === null) {
      await client.$executeRaw`
        UPDATE products
           SET enrichment_done = true,
               enrichment_source_hash = ${hash},
               enrichment_attempts = 0,
               enrichment_error_code = NULL,
               enrichment_next_attempt_at = NULL,
               updated_at = now()
         WHERE id = ${productId}::uuid`;
      return;
    }
    await client.$executeRaw`
      UPDATE products
         SET description_enriched = ${enriquecido},
             enrichment_done = true,
             enrichment_source_hash = ${hash},
             enrichment_attempts = 0,
             enrichment_error_code = NULL,
             enrichment_next_attempt_at = NULL,
             updated_at = now()
       WHERE id = ${productId}::uuid`;
  }

  /**
   * Registra un fallo del proveedor: cuenta el intento, agenda el próximo con **backoff
   * durable** y deja el código de error (US-005 T3.3, AC-5).
   *
   * El estado del reintento vive en la base y no en memoria: un redeploy a mitad de corrida
   * no pierde ni el conteo ni la espera. Es exactamente la crítica que ADR-0012 se hacía a sí
   * mismo, cubierta acá.
   *
   * Al alcanzar `ENRICHMENT_MAX_ATTEMPTS` el producto queda **abandonado**: `claimBatch`
   * deja de devolverlo, conserva su `description_raw` y **sigue visible** en el listado
   * público. Degradó sin desaparecer.
   */
  async registerFailure(productId: string, errorCode: string): Promise<void> {
    const escalera = EnrichmentService.BACKOFF_DURABLE_MS;
    const filas = await this.prisma.$queryRaw<Array<{ enrichment_attempts: number }>>`
      SELECT enrichment_attempts FROM products WHERE id = ${productId}::uuid`;
    const intentos = (filas[0]?.enrichment_attempts ?? 0) + 1;
    const esperaMs = escalera[Math.min(intentos - 1, escalera.length - 1)];

    await this.prisma.$executeRaw`
      UPDATE products
         SET enrichment_attempts = ${intentos},
             enrichment_error_code = ${errorCode},
             enrichment_next_attempt_at = now() + make_interval(secs => ${esperaMs / 1000}::double precision),
             updated_at = now()
       WHERE id = ${productId}::uuid`;
  }

  /** Backoff durable del `design.md` §Resiliencia: 1 m · 5 m · 25 m · 2 h · 10 h. */
  static readonly BACKOFF_DURABLE_MS = [
    60_000,
    300_000,
    1_500_000,
    7_200_000,
    36_000_000,
  ];

  /** `true` si el producto ya agotó sus intentos (quedó abandonado, AC-5). */
  isAbandoned(attempts: number): boolean {
    return attempts >= this.config.get<number>('ENRICHMENT_MAX_ATTEMPTS', 5);
  }
}
