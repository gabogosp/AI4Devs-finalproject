import { parseContract } from '@/lib/http/contract';
import { storefrontGetNewArrivals, storefrontGetBestSellers } from '@/api/generated/endpoints';
import {
  StorefrontGetNewArrivalsResponse,
  StorefrontGetBestSellersResponse,
} from '@/api/generated/zod';
import type { StorefrontProductListItem } from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO (`frontend-standards` §3.1/§3.2). Nunca a mano.
 */
export type { StorefrontProductListItem };

/**
 * Lógica de servicio de los destacados del home (`frontend-standards` §3.3 —
 * lo único hand-written). La red va por las operaciones **generadas** (F48) y
 * cada respuesta se valida en el borde con el schema Zod generado. Ambas
 * rutas son públicas — sin marca `session`, mismo criterio que
 * `storefrontGetProduct` (`design.md` T-B0).
 *
 * Ambos métodos devuelven `StorefrontProductListItem[]` plano: el contrato
 * responde un envelope `HighlightedProductsResponse { data }` sin objeto de
 * paginación (no es un listado navegable, `design.md` T-B0) — el `.data` se
 * unwrappea acá para que `HomeFeaturedSection` (Fase A) siga recibiendo
 * exactamente el array que ya esperaba.
 *
 * La caché se declara **por método**, en el sitio de la llamada, nunca
 * compartida (`design.md` §D5 — la lección de US-025 PR #139): cada sección
 * es una fuente de datos independiente (AC-4/AC-5 pueden faltar por
 * separado), así que cada una lleva su propio `tags` para que una futura
 * invalidación on-demand de una no pise la otra.
 */
export const homeFeaturedService = {
  /** "Novedades": últimos productos publicados (US §8 AC-1, AC-3, AC-4). */
  async getNovedades(): Promise<StorefrontProductListItem[]> {
    const res = await storefrontGetNewArrivals({
      next: { revalidate: 60, tags: ['home:novedades'] },
    });
    return parseContract(StorefrontGetNewArrivalsResponse, res.data).data;
  },

  /** "Más vendidos": ranking real de ventas (US §8 AC-2, AC-5, AC-6, AC-7). */
  async getMasVendidos(): Promise<StorefrontProductListItem[]> {
    const res = await storefrontGetBestSellers({
      next: { revalidate: 60, tags: ['home:mas-vendidos'] },
    });
    return parseContract(StorefrontGetBestSellersResponse, res.data).data;
  },
};
