import { Injectable } from '@nestjs/common';
import { Category, Prisma, Product } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../common/errors/domain-errors';
import {
  isPrismaError,
  PRISMA_FK_VIOLATION,
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
  uniqueTargetIncludes,
} from '../common/prisma-errors';

export interface CreateProductData {
  sku: string;
  slug: string;
  name: string;
  description_raw?: string | null;
  price_ars_cents: number;
  stock?: number;
  status?: string;
  category_id: string;
  image_url?: string | null;
}

export type UpdateProductData = Prisma.ProductUncheckedUpdateInput;

/** Lo que la reconciliación por SKU del import necesita saber de un producto ya existente. */
export interface ImportProductRef {
  id: string;
  slug: string;
  description_raw: string | null;
  status: string;
}

/**
 * Fila del import lista para escribir.
 *
 * Todo lo que no es `sku` es **opcional**, y esa opcionalidad es la semántica de
 * OQ-BE-2: un campo ausente significa **"no cambiar"**. Es lo que permite el
 * archivo de sólo precios del día 2 sin pisar el stock real ni las descripciones.
 *
 * Para **crear** hacen falta `name`, `priceArsCents`, `stock` y `categoryId`; el
 * service lo garantiza antes de llegar acá (`faltantesParaAlta`) y el repositorio
 * lo vuelve a chequear porque un `create` sin ellos violaría el `NOT NULL` de la
 * base con un error mucho menos claro.
 */
export interface ImportUpsertData {
  sku: string;
  /** Slug propuesto por el allocator. Sólo se usa al **crear**. */
  slug: string;
  name?: string;
  descriptionRaw?: string;
  priceArsCents?: number;
  stock?: number;
  categoryId?: string;
  imageUrl?: string;
}

export interface ImportUpsertResult {
  outcome: 'created' | 'updated';
  id: string;
  slug: string;
}

export interface Pagination {
  limit: number;
  offset: number;
}

/**
 * Proyección que consume la vista del carrito (US-007). Está declarada una vez
 * para que las dos lecturas —por slug y por id— no puedan divergir en campos.
 */
const CART_PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  image_url: true,
  price_ars_cents: true,
  stock: true,
  status: true,
} as const;

export type CartProduct = Pick<
  Product,
  'id' | 'slug' | 'name' | 'image_url' | 'price_ars_cents' | 'stock' | 'status'
>;

/** Único punto de acceso al ORM para `products` (§5). Traduce códigos Prisma. */
@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateProductData): Promise<Product> {
    try {
      return await this.prisma.product.create({
        data: {
          sku: data.sku,
          slug: data.slug,
          name: data.name,
          description_raw: data.description_raw ?? null,
          price_ars_cents: data.price_ars_cents,
          stock: data.stock ?? 0,
          status: data.status ?? 'draft',
          category_id: data.category_id,
          image_url: data.image_url ?? null,
        },
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  async findMany(
    page: Pagination,
  ): Promise<{ data: Product[]; total: number }> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        take: page.limit,
        skip: page.offset,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.product.count(),
    ]);
    return { data, total };
  }

  findById(id: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id } });
  }

  /**
   * Slugs ya tomados que arrancan con `base` — insumo de la desambiguación
   * determinista del service (US-003 T10.2). El filtro por prefijo acota el
   * set al mínimo necesario en lugar de traer la tabla entera.
   */
  async findSlugsByPrefix(base: string): Promise<string[]> {
    const rows = await this.prisma.product.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    return rows.map((r) => r.slug);
  }

  /**
   * Igual que `findSlugsByPrefix` pero para **varias** bases en una sola ida a
   * la base (US-006 T2.2). El import de 5.000 filas haría 5.000 queries con la
   * versión de a uno; con lotes de 200 hace 25.
   *
   * `OR` de prefijos y no `in` de slugs exactos: hay que ver también los slugs
   * ya desambiguados (`heladera-2`) para no volver a proponerlos.
   */
  async findSlugsByPrefixes(bases: string[]): Promise<string[]> {
    if (bases.length === 0) return [];
    const rows = await this.prisma.product.findMany({
      where: { OR: bases.map((base) => ({ slug: { startsWith: base } })) },
      select: { slug: true },
    });
    return rows.map((r) => r.slug);
  }

  /**
   * Lectura pública del storefront (US-003 AC-1/AC-7/AC-8): sólo productos
   * `published`, con su categoría. Devuelve `null` (no lanza) para cualquier
   * no-match — draft, archived o inexistente colapsan al mismo `null`, así el
   * service decide un 404 idéntico (sin enumeration leak). El identificador
   * público es el `slug` (OQ-BE-1 resuelta en T10.1: URL amigable indexable).
   */
  findPublishedBySlug(
    slug: string,
  ): Promise<(Product & { category: Category }) | null> {
    return this.prisma.product.findFirst({
      where: { slug, status: 'published' },
      include: { category: true },
    });
  }

  /**
   * Lectura de las líneas del carrito (US-007 T2.2): trae los productos de un
   * conjunto de slugs **sin filtrar por estado**, a propósito.
   *
   * Es la contracara de `findPublishedBySlug`. El carrito necesita ver también los
   * `draft` y `archived` para poder **marcarlos** como no disponibles (AC-6): si
   * los filtrara, la línea desaparecería del carrito sin explicación y el cliente
   * perdería la información de qué quería. Agregar sigue yendo por
   * `findPublishedBySlug`, y por eso AC-10 devuelve el mismo 404 que un slug
   * inexistente.
   *
   * Una sola query para todo el conjunto: la lectura del carrito está acotada por
   * `CART_MAX_ITEMS`, pero un N+1 acá sería 50 round-trips por `GET`.
   */
  findManyBySlugs(slugs: string[]): Promise<CartProduct[]> {
    if (slugs.length === 0) return Promise.resolve([]);
    return this.prisma.product.findMany({
      where: { slug: { in: slugs } },
      select: CART_PRODUCT_SELECT,
    });
  }

  /**
   * Igual que `findManyBySlugs` pero por id — es la forma en que la **lectura del
   * carrito** llega a los productos, porque `cart_items` referencia `product_id`.
   * Tampoco filtra por estado, por la misma razón (AC-6: marcar, no ocultar).
   */
  findManyByIds(ids: string[]): Promise<CartProduct[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: CART_PRODUCT_SELECT,
    });
  }

  /**
   * Listado público por categorías (US-002 AC-3/AC-7/AC-8). Recibe varios ids
   * porque un rubro agrega los productos de sus subrubros (decisión D1); un
   * subrubro pasa un solo id. Sólo `published`: draft/archived nunca aparecen,
   * ni en `data` ni en `total`. El tie-break por `id` hace el orden total, así
   * el offset es determinista y dos páginas consecutivas no se solapan.
   */
  async findPublishedByCategoryIds(
    ids: string[],
    page: Pagination,
  ): Promise<{ data: Product[]; total: number }> {
    const where = { category_id: { in: ids }, status: 'published' };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: page.offset,
        take: page.limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { data, total };
  }

  async update(id: string, data: UpdateProductData): Promise<Product> {
    try {
      return await this.prisma.product.update({ where: { id }, data });
    } catch (error) {
      throw this.translate(error);
    }
  }

  /**
   * Lectura por SKUs del import (US-006 T3.2): una consulta para todo el lote,
   * indexada por `sku`. Devuelve sólo lo que la reconciliación necesita decidir
   * —¿existe?, ¿cambió la descripción?— y no el producto entero.
   */
  async findManyBySkus(skus: string[]): Promise<Map<string, ImportProductRef>> {
    if (skus.length === 0) return new Map();
    const rows = await this.prisma.product.findMany({
      where: { sku: { in: skus } },
      select: {
        id: true,
        sku: true,
        slug: true,
        description_raw: true,
        status: true,
      },
    });
    return new Map(
      rows.map((r) => [
        r.sku,
        {
          id: r.id,
          slug: r.slug,
          description_raw: r.description_raw,
          status: r.status,
        },
      ]),
    );
  }

  /**
   * Alta o actualización de una fila del import, atómica (US-006 T3.2).
   *
   * Lo que **no** se toca al actualizar es tan importante como lo que sí:
   *
   * - `slug`: regla heredada de US-003 — la URL ya pudo indexarse y regenerarla
   *   la rompería. Un import que renombra "Heladera" a "Heladera Exhibidora"
   *   mantiene `/productos/heladera`.
   * - `status`: AC-9 — el import **no publica ni despublica**. Publicar es una
   *   decisión explícita del dueño sobre un producto que ya revisó.
   * - `sku`: es la clave de la reconciliación.
   *
   * `enrichment_done` vuelve a `false` sólo si cambió `description_raw` (E2E
   * §9.3): re-enriquecer un producto al que sólo le movieron el precio sería
   * pagarle a Gemini por un resultado idéntico.
   */
  async upsertFromImport(
    data: ImportUpsertData,
  ): Promise<ImportUpsertResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existente = await tx.product.findUnique({
          where: { sku: data.sku },
          select: { id: true, slug: true, description_raw: true },
        });

        if (existente === null) {
          if (
            data.name === undefined ||
            data.priceArsCents === undefined ||
            data.stock === undefined ||
            data.categoryId === undefined
          ) {
            // Inalcanzable por contrato (el service filtra las filas incompletas
            // antes de llamar), pero explícito a propósito: sin esto el `create`
            // fallaría contra el NOT NULL de la base con un error opaco que el
            // reporte mostraría como `write_failed`.
            throw new ValidationError(
              'La fila no tiene los datos mínimos para crear el producto',
              [{ field: 'sku', message: 'faltan datos obligatorios del alta' }],
            );
          }
          const creado = await tx.product.create({
            data: {
              sku: data.sku,
              slug: data.slug,
              name: data.name,
              description_raw: data.descriptionRaw ?? null,
              price_ars_cents: data.priceArsCents,
              stock: data.stock,
              status: 'draft',
              category_id: data.categoryId,
              image_url: data.imageUrl ?? null,
              enrichment_done: false,
            },
            select: { id: true, slug: true },
          });
          return { outcome: 'created' as const, id: creado.id, slug: creado.slug };
        }

        // `undefined` = la celda vino vacía ⇒ no cambiar ese campo (OQ-BE-2).
        const cambiaDescripcion =
          data.descriptionRaw !== undefined &&
          data.descriptionRaw !== existente.description_raw;

        const actualizado = await tx.product.update({
          where: { id: existente.id },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.priceArsCents !== undefined
              ? { price_ars_cents: data.priceArsCents }
              : {}),
            ...(data.stock !== undefined ? { stock: data.stock } : {}),
            ...(data.categoryId !== undefined
              ? { category_id: data.categoryId }
              : {}),
            ...(data.descriptionRaw !== undefined
              ? { description_raw: data.descriptionRaw }
              : {}),
            ...(data.imageUrl !== undefined ? { image_url: data.imageUrl } : {}),
            ...(cambiaDescripcion ? { enrichment_done: false } : {}),
          },
          select: { id: true, slug: true },
        });
        return {
          outcome: 'updated' as const,
          id: actualizado.id,
          slug: actualizado.slug,
        };
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): unknown {
    if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
      // `products` tiene dos únicos (sku y slug): sin mirar el target, una
      // colisión de slug se reportaría como "SKU duplicado" y confundiría al
      // operador. El slug lo deriva el server (T10.2), así que su colisión es
      // una carrera, no un error de input.
      if (uniqueTargetIncludes(error, 'slug')) {
        return new ConflictError('URL de producto duplicada', [
          { field: 'slug', message: 'URL de producto duplicada' },
        ]);
      }
      return new ConflictError('SKU duplicado', [
        { field: 'sku', message: 'SKU duplicado' },
      ]);
    }
    if (isPrismaError(error, PRISMA_FK_VIOLATION)) {
      return new ValidationError('La categoría indicada no existe', [
        { field: 'category_id', message: 'la categoría no existe' },
      ]);
    }
    if (isPrismaError(error, PRISMA_RECORD_NOT_FOUND)) {
      return new NotFoundError('Producto no encontrado');
    }
    return error;
  }
}
