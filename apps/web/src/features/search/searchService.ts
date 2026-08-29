import { parseContract } from '@/lib/http/contract';
import { searchProducts } from '@/api/generated/endpoints';
import { SearchProductsResponse } from '@/api/generated/zod';
import type { SearchResponse, SearchResult } from '@/api/generated/model';
import { CATALOG_TAG } from '@/features/storefront/categoriesStorefrontService';

/**
 * Tipos DERIVADOS DEL CONTRATO (`frontend-standards` §3.1/§3.2). Nunca a mano:
 * una `interface SearchResponse` escrita acá compilaría contra el contrato de
 * ayer y nadie se enteraría hasta ver la pantalla.
 */
export type { SearchResponse, SearchResult };

/**
 * El contrato ya declara `max-age=60, stale-while-revalidate=30` para esta
 * respuesta, así que la caché de Next acompaña ese número en lugar de inventar
 * otro. Es corta a propósito: la búsqueda es contenido público derivado del
 * catálogo, pero el resultado depende del stock y del precio, y sesenta segundos
 * de desfasaje es lo que el backend ya consideró tolerable.
 */
export const SEARCH_REVALIDATE_SECONDS = 60;

/**
 * Se comparte el tag del catálogo **importándolo**, no repitiendo el literal: la
 * Server Action que el panel dispara al mutar un producto invalida `CATALOG_TAG`
 * y tiene que barrer también estos resultados. Con un literal propio, un
 * producto despublicado seguiría apareciendo en la búsqueda hasta que venciera
 * el minuto, que es justo el caso que la invalidación existe para evitar.
 *
 * Sin `as const` y construido por llamada, por lo mismo que en el servicio del
 * catálogo: `next.tags` es `string[]` mutable y compartir el array entre fetches
 * lo expone a que alguien lo mute.
 */
const searchCache = (): { next: { revalidate: number; tags: string[] } } => ({
  next: { revalidate: SEARCH_REVALIDATE_SECONDS, tags: [CATALOG_TAG] },
});

/**
 * Lógica de servicio de la búsqueda (`frontend-standards` §3.3 — lo único
 * hand-written). La red va por la operación **generada** (F48) y la respuesta se
 * valida en el borde con el schema Zod generado.
 *
 * Lo que este servicio NO hace es tan importante como lo que hace: no decide si
 * la consulta merece un request (eso es `queryGuard`, y vive antes), no traduce
 * errores a copy (eso es `searchErrorCopy`), y no interpreta `confidence` ni
 * `degraded` — los devuelve tal cual para que la UI los presente. Un 422/429/503
 * sale como `AppErrorException` desde el mutator, así que acá no hay `try`:
 * tragarse el error y devolver una respuesta vacía convertiría un rate-limit en
 * un «no encontramos nada», que es exactamente la mentira que AC-3 y AC-10
 * quieren evitar.
 */
export const searchService = {
  async search(q: string, limit?: number): Promise<SearchResponse> {
    const res = await searchProducts(
      limit === undefined ? { q } : { q, limit },
      searchCache(),
    );
    return parseContract(SearchProductsResponse, res.data);
  },
};
