import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { nuevaCategoria, nuevoProducto } from './builders';

export interface CategoriaSembrada {
  id: string;
  slug: string;
  name: string;
}

export interface ProductoSembrado {
  id: string;
  slug: string;
  sku: string;
  name: string;
  price_ars_cents: number;
}

export interface SeedCategorias {
  token: string;
  /** Rubro raíz. Agrega los productos de sus hijos (regla del backend D-1). */
  rubro: CategoriaSembrada;
  /** Subrubro del rubro anterior — lista SÓLO los propios. */
  subrubro: CategoriaSembrada;
  /** Rubro publicado sin ningún producto publicado (AC-6). */
  vacia: CategoriaSembrada;
  /** Publicados con stock en el subrubro; son 21 para forzar la página 2. */
  publicados: ProductoSembrado[];
  /** Publicado con stock 0: visible en la grilla, no comprable (AC-5). */
  sinStock: ProductoSembrado;
  /** Publicado directamente en el rubro padre — prueba la agregación (AC-1). */
  enRubro: ProductoSembrado;
  /** Nunca publicado: no debe aparecer en ningún listado (AC-8). */
  draft: ProductoSembrado;
  /** Publicado y luego archivado por la FSM real (AC-8). */
  archivado: ProductoSembrado;
}

/** PAGE_SIZE del frontend. 21 publicados con stock + 1 sin stock ⇒ 2 páginas. */
const PAGE_SIZE = 20;
const PUBLICADOS_EN_SUBRUBRO = PAGE_SIZE + 1;

/**
 * Siembra el árbol de navegación que US-002 necesita ejercitar: un rubro con un
 * subrubro, productos en ambos niveles, los estados no publicables y una
 * categoría vacía.
 *
 * Todo vía la **API real**, nunca INSERT directo: así respeta la máquina de
 * estado (`draft → published → archived`), la derivación server-side del `slug`
 * y la relación padre-hijo. Un seed por SQL produciría filas que la aplicación
 * nunca habría aceptado, y los tests pasarían contra datos imposibles.
 *
 * Idempotente entre corridas por el prefijo único de `builders`.
 */
export async function seedCategorias(): Promise<SeedCategorias> {
  const token = await adminAuth();

  const crearCategoria = (over: Record<string, unknown> = {}) =>
    apiCall<CategoriaSembrada>('/v1/admin/categories', 'POST', token, {
      ...nuevaCategoria(),
      ...over,
    });

  const rubro = await crearCategoria();
  const subrubro = await crearCategoria({ parent_id: rubro.id });
  const vacia = await crearCategoria();

  const crearProducto = (categoryId: string, over: Record<string, unknown> = {}) =>
    apiCall<ProductoSembrado>(
      '/v1/admin/products',
      'POST',
      token,
      nuevoProducto(categoryId, over),
    );

  const publicar = (id: string) =>
    apiCall<ProductoSembrado>(`/v1/admin/products/${id}`, 'PATCH', token, {
      status: 'published',
    });

  const crearYPublicar = async (
    categoryId: string,
    over: Record<string, unknown> = {},
  ): Promise<ProductoSembrado> => {
    const p = await crearProducto(categoryId, over);
    return publicar(p.id);
  };

  // Secuencial a propósito: en paralelo, el orden de creación —y por lo tanto el
  // de la grilla ordenada— deja de ser determinista entre corridas.
  const publicados: ProductoSembrado[] = [];
  for (let i = 0; i < PUBLICADOS_EN_SUBRUBRO; i += 1) {
    publicados.push(await crearYPublicar(subrubro.id, { stock: 5 }));
  }

  const sinStock = await crearYPublicar(subrubro.id, { stock: 0 });
  const enRubro = await crearYPublicar(rubro.id, { stock: 4 });

  // Draft: se crea y NO se publica.
  const draft = await crearProducto(subrubro.id, { stock: 2 });

  // Archivado: publicar y después archivar — el camino real de la FSM, no un
  // atajo que dejaría el producto en un estado que la app nunca produce.
  const a = await crearProducto(subrubro.id, { stock: 3 });
  await publicar(a.id);
  const archivado = await apiCall<ProductoSembrado>(
    `/v1/admin/products/${a.id}`,
    'PATCH',
    token,
    { status: 'archived' },
  );

  return {
    token,
    rubro,
    subrubro,
    vacia,
    publicados,
    sinStock,
    enRubro,
    draft,
    archivado,
  };
}
