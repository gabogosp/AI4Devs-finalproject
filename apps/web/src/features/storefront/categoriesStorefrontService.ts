import { parseContract } from '@/lib/http/contract';
import {
  storefrontGetCategory,
  storefrontListCategories,
  storefrontListCategoryProducts,
} from '@/api/generated/endpoints';
import {
  StorefrontGetCategoryResponse,
  StorefrontListCategoriesResponse,
  StorefrontListCategoryProductsResponse,
} from '@/api/generated/zod';
import type {
  CategoryTreeNode,
  StorefrontCategory,
  StorefrontProductPage,
} from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO (`frontend-standards` §3.1/§3.2). Nunca a mano.
 */
export type { CategoryTreeNode, StorefrontCategory, StorefrontProductPage };

/**
 * Tag ÚNICO de todo el catálogo público (design.md D2) — **única fuente** del
 * literal: la Server Action de invalidación lo importa en lugar de repetirlo.
 *
 * Es grueso a propósito. Un tag por categoría obligaría al panel a derivar, por
 * producto mutado, su categoría anterior y la nueva; olvidarse de una deja la
 * grilla mintiendo.
 */
export const CATALOG_TAG = 'catalog';

/**
 * Safety-net, NO la vía de frescura: la inmediatez la da `revalidateCatalog()`.
 * Sin esto, un fallo de la invalidación dejaría el listado desactualizado de
 * forma indefinida.
 */
export const CATALOG_REVALIDATE_SECONDS = 3600;

/**
 * = default del contrato. NO es configurable por query (design.md D3): con un
 * `limit` fijo, el catálogo completo no puede viajar en una sola respuesta
 * aunque alguien manipule la URL (AC-7 por construcción).
 */
export const PAGE_SIZE = 20;

/**
 * Sin `as const`: `next.tags` del `RequestInit` de Next es `string[]` mutable y
 * una tupla readonly no le asigna. Se construye por llamada para no compartir
 * el array entre fetches.
 */
const catalogCache = (): { next: { revalidate: number; tags: string[] } } => ({
  next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [CATALOG_TAG] },
});

/**
 * Lógica de servicio del catálogo público (`frontend-standards` §3.3 — lo único
 * hand-written). La red va por las operaciones **generadas** (F48) y cada
 * respuesta se valida en el borde con el schema Zod generado.
 *
 * La política de caché se declara acá, no en el mutator (next-standards §3:
 * caché explícita, tagear lo que se piensa revalidar).
 */
export const categoriesStorefrontService = {
  /** Árbol de dos niveles: rubros con sus subrubros directos. */
  async getTree(): Promise<CategoryTreeNode[]> {
    const res = await storefrontListCategories(catalogCache());
    return parseContract(StorefrontListCategoriesResponse, res.data).data;
  },

  /** Detalle con `parent` (breadcrumb) y `children` (subrubros). 404 → `notFound`. */
  async getBySlug(slug: string): Promise<StorefrontCategory> {
    const res = await storefrontGetCategory(slug, catalogCache());
    return parseContract(StorefrontGetCategoryResponse, res.data);
  },

  /**
   * Listado paginado. Traduce `page → offset` con `PAGE_SIZE`; el envelope
   * `{ data, pagination }` es el del contrato vivo (`api-standards` §6.1/§6.3),
   * así que `hasNext` se deriva de `limit/offset/total` y no de links.
   */
  async listProducts(slug: string, page: number): Promise<StorefrontProductPage> {
    const res = await storefrontListCategoryProducts(slug, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }, catalogCache());
    return parseContract(StorefrontListCategoryProductsResponse, res.data);
  },
};
