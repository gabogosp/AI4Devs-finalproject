import { apiCall } from './api';
import { nuevoProducto } from './builders';

export interface ProductoSembrado {
  id: string;
  sku: string;
  slug: string;
  name: string;
  price_ars_cents: number;
  stock: number;
  status: string;
  category_id: string;
}

interface CategoriaAdmin {
  id: string;
  name: string;
}

/** Resuelve (o crea) una categoría admin por nombre exacto — nunca por SQL. */
export async function categoriaPorNombre(
  token: string,
  name: string,
): Promise<CategoriaAdmin> {
  return apiCall<CategoriaAdmin>('/v1/admin/categories', 'POST', token, { name });
}

/**
 * Producto **publicado** con stock, para los escenarios que necesitan un
 * estado previo conocido (TC-601 "REF-EXISTE", TC-603, TC-619 storefront).
 * Nunca por SQL: pasa por la misma FSM `draft → published` que usa cualquier
 * alta manual, así que el test no puede pasar contra un estado que la
 * aplicación no podría producir.
 */
export async function sembrarProductoPublicado(
  token: string,
  categoryId: string,
  over: Partial<{
    sku: string;
    name: string;
    price_ars_cents: number;
    stock: number;
  }> = {},
): Promise<ProductoSembrado> {
  const creado = await apiCall<ProductoSembrado>(
    '/v1/admin/products',
    'POST',
    token,
    nuevoProducto(categoryId, over),
  );
  return apiCall<ProductoSembrado>(`/v1/admin/products/${creado.id}`, 'PATCH', token, {
    status: 'published',
  });
}

/** Total de productos del catálogo, vía `pagination.total` (nunca SQL). */
export async function contarProductos(token: string): Promise<number> {
  const respuesta = await apiCall<{ pagination: { total: number } }>(
    '/v1/admin/products?limit=1',
    'GET',
    token,
  );
  return respuesta.pagination.total;
}

/**
 * Cobertura agregada de enriquecimiento (`GET /v1/admin/enrichment/status`).
 * Es la única costura observable a nivel API para AC-3/TC-605 (OQ-QA-2): no hay
 * endpoint que exponga `enrichment_done` por producto, y no hay forma de
 * **sembrar** un producto ya enriquecido sin `GEMINI_API_KEY` real (crear o
 * tocar `description_raw`/`description_enriched` siempre deja el producto en
 * `enrichment_done = false`). Por eso TC-605 verifica el delta del contador
 * agregado, declarado y no escondido: prueba "el SKU nuevo queda pendiente",
 * no "un producto que YA estaba enriquecido se mantiene así" — esa mitad
 * queda para cuando US-005 tenga su clave cargada.
 */
export async function pendientesDeEnriquecimiento(token: string): Promise<number> {
  const respuesta = await apiCall<{ coverage: { pending: number } }>(
    '/v1/admin/enrichment/status',
    'GET',
    token,
  );
  return respuesta.coverage.pending;
}
