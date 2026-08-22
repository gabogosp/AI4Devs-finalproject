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
