import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { nuevaCategoria, nuevoProducto } from './builders';

export interface ProductoSembradoEnrichment {
  id: string;
  slug: string;
  sku: string;
  /** Slug de la categoría — SC-005-C2 necesita listar `/v1/categories/{slug}/products` (US-002). */
  categorySlug: string;
  /** El texto sembrado — SC-005-C2 necesita confirmar que quedó intacto tras el abandono. */
  descriptionRaw: string;
}

/**
 * Descripciones base "pobres" reales (< 20 caracteres) — el disparador de la
 * elegibilidad para enriquecer (US-005 AC-1, `design.md §Approach` del
 * backend). Rotan sobre un set pequeño en vez de repetir literalmente la
 * misma cadena: no cambia el comportamiento (el hash del texto fuente incluye
 * el nombre del producto, así que ya difiere entre filas), pero deja los
 * fixtures legibles en una traza de fallo.
 */
const DESCRIPCIONES_POBRES = ['Bueno.', 'Anda bien.', 'Sirve.', 'Ok.', 'Anda.'];

/**
 * Siembra un lote de `n` productos **publicados**, con `description_raw`
 * pobre, vía la API real (`POST /v1/admin/products` + `PATCH .../publish`,
 * nunca INSERT directo — mismo patrón que `seed-busqueda.ts`/`seed-ficha.ts`).
 * Todos nacen con `enrichment_done = false` (default de la columna, sin
 * tocarla) — elegibles de inmediato para `claimBatch`.
 *
 * Usado por SC-005-C1/C2/C4 y `qa/performance/storefront-under-enrichment.js`
 * (T3.1) para tener trabajo real que el runner pueda tomar.
 */
export async function sembrarLotePendiente(
  n: number,
): Promise<ProductoSembradoEnrichment[]> {
  const token = await adminAuth();
  const categoria = await apiCall<{ id: string; slug: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );

  const productos: ProductoSembradoEnrichment[] = [];
  for (let i = 0; i < n; i += 1) {
    const descriptionRaw = DESCRIPCIONES_POBRES[i % DESCRIPCIONES_POBRES.length]!;
    const creado = await apiCall<{ id: string }>(
      '/v1/admin/products',
      'POST',
      token,
      nuevoProducto(categoria.id, { description_raw: descriptionRaw }),
    );
    const publicado = await apiCall<{ id: string; slug: string; sku: string }>(
      `/v1/admin/products/${creado.id}`,
      'PATCH',
      token,
      { status: 'published' },
    );
    productos.push({ ...publicado, categorySlug: categoria.slug, descriptionRaw });
  }
  return productos;
}

/**
 * Siembra UN producto publicado, pendiente de enriquecer — azúcar sobre
 * `sembrarLotePendiente(1)` para los escenarios que sólo necesitan un
 * producto (SC-005-C2, la aceptación de abandono completo).
 */
export async function sembrarUnPendiente(): Promise<ProductoSembradoEnrichment> {
  const [producto] = await sembrarLotePendiente(1);
  return producto!;
}

/**
 * Siembra un producto en `status: "draft"`, pendiente de enriquecer y SIN
 * publicar — SC-005-N5 (AC-10: el enriquecimiento nunca publica, éxito o
 * falla).
 */
export async function sembrarProductoDraft(): Promise<ProductoSembradoEnrichment> {
  const token = await adminAuth();
  const categoria = await apiCall<{ id: string; slug: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );
  const descriptionRaw = DESCRIPCIONES_POBRES[0]!;
  const creado = await apiCall<{ id: string; slug: string; sku: string }>(
    '/v1/admin/products',
    'POST',
    token,
    nuevoProducto(categoria.id, { description_raw: descriptionRaw }),
  );
  return { ...creado, categorySlug: categoria.slug, descriptionRaw };
}
