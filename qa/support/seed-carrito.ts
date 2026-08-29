import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { nuevaCategoria, nuevoProducto } from './builders';

export interface ProductoSembrado {
  id: string;
  slug: string;
  sku: string;
  name: string;
  price_ars_cents: number;
}

export interface SeedCarrito {
  token: string;
  categoryId: string;
  /**
   * Stock **exactamente 3**. Es el tope de AC-5 y la invariante de AC-8: sin un
   * número conocido y chico, N-2 no puede distinguir un carrito que no reserva
   * de uno que sí — con stock alto, tres invitados entran igual.
   */
  stockTres: ProductoSembrado;
  /** Dos publicados con stock ≥ 2 para el carrito mixto. */
  mixtoA: ProductoSembrado;
  mixtoB: ProductoSembrado;
  /** Publicado, para despublicarlo en vuelo y ejercitar AC-6. */
  paraDespublicar: ProductoSembrado;
  /** Publicado, para cambiarle el precio en vuelo y ejercitar AC-9. */
  paraCambiarPrecio: ProductoSembrado;
  /** Nunca publicado: no debe poder agregarse (AC-10). */
  draft: ProductoSembrado;
  /** Publicado y luego archivado por la FSM real (AC-10). */
  archivado: ProductoSembrado;
}

/** Stock de la invariante de AC-8. Se exporta: los escenarios lo asertan. */
export const STOCK_INVARIANTE = 3;

/**
 * Siembra las siete fixturas que los escenarios del carrito necesitan.
 *
 * Todo vía la **API real**, nunca INSERT directo: así respeta la máquina de
 * estado (`draft → published → archived`), la derivación server-side del `slug`
 * y las validaciones por campo. Un seed por SQL produciría filas que la
 * aplicación nunca habría aceptado, y los tests pasarían contra datos
 * imposibles.
 *
 * Creación **secuencial** a propósito: en paralelo el orden deja de ser
 * determinista entre corridas. Idempotente por el prefijo único de `builders`.
 */
export async function seedCarrito(): Promise<SeedCarrito> {
  const token = await adminAuth();

  const category = await apiCall<{ id: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );

  const crear = (over: Record<string, unknown>) =>
    apiCall<ProductoSembrado>(
      '/v1/admin/products',
      'POST',
      token,
      nuevoProducto(category.id, over),
    );

  const publicar = (id: string) =>
    apiCall<ProductoSembrado>(`/v1/admin/products/${id}`, 'PATCH', token, {
      status: 'published',
    });

  const crearYPublicar = async (over: Record<string, unknown>) =>
    publicar((await crear(over)).id);

  const stockTres = await crearYPublicar({ stock: STOCK_INVARIANTE });
  const mixtoA = await crearYPublicar({ stock: 5 });
  const mixtoB = await crearYPublicar({ stock: 4 });
  const paraDespublicar = await crearYPublicar({ stock: 5 });
  const paraCambiarPrecio = await crearYPublicar({ stock: 5, price_ars_cents: 100000 });

  // Draft: se crea y NO se publica.
  const draft = await crear({ stock: 2 });

  // Archivado: publicar y después archivar — el camino real de la FSM, no un
  // atajo que dejaría el producto en un estado que la app nunca produce.
  const a = await crear({ stock: 4 });
  await publicar(a.id);
  const archivado = await apiCall<ProductoSembrado>(
    `/v1/admin/products/${a.id}`,
    'PATCH',
    token,
    { status: 'archived' },
  );

  return {
    token,
    categoryId: category.id,
    stockTres,
    mixtoA,
    mixtoB,
    paraDespublicar,
    paraCambiarPrecio,
    draft,
    archivado,
  };
}
