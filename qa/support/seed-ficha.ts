import { adminAuth } from './admin-auth';
import { nuevaCategoria, nuevoProducto } from './builders';

const API = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';

async function apiCall<T>(
  path: string,
  method: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export interface ProductoSembrado {
  id: string;
  slug: string;
  sku: string;
  name: string;
  price_ars_cents: number;
}

export interface SeedFicha {
  token: string;
  categoryId: string;
  /** Publicado, con stock e imagen — el caso feliz (AC-1/AC-3). */
  publicado: ProductoSembrado;
  /** Publicado con stock 0 — visible, no comprable (AC-4). */
  sinStock: ProductoSembrado;
  /** Publicado sin imagen — placeholder (AC-6). */
  sinImagen: ProductoSembrado;
  /** Queda en draft — no accesible por URL (AC-7). */
  draft: ProductoSembrado;
  /** Archivado — no accesible por URL (AC-7). */
  archivado: ProductoSembrado;
}

/**
 * Siembra los estados de producto que la ficha pública necesita ejercitar.
 *
 * Todo vía la **API real**, nunca INSERT directo: así respeta la máquina de
 * estado (`draft → published → archived`), las validaciones por campo y la
 * derivación server-side del `slug`. Un seed por SQL produciría filas que la
 * aplicación nunca habría aceptado y los tests pasarían contra datos imposibles.
 *
 * Idempotente entre corridas por el prefijo único de `builders`.
 */
export async function seedFichaPublica(): Promise<SeedFicha> {
  const token = await adminAuth();

  const category = await apiCall<{ id: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );

  const crear = async (
    over: Record<string, unknown>,
  ): Promise<ProductoSembrado> => {
    const p = await apiCall<ProductoSembrado>(
      '/v1/admin/products',
      'POST',
      token,
      nuevoProducto(category.id, over),
    );
    return p;
  };

  const publicar = async (id: string): Promise<ProductoSembrado> =>
    apiCall<ProductoSembrado>(`/v1/admin/products/${id}`, 'PATCH', token, {
      status: 'published',
    });

  // Caso feliz: stock e imagen.
  const base = await crear({
    stock: 7,
    image_url: 'https://example.com/heladera.jpg',
  });
  const publicado = await publicar(base.id);

  // Sin stock: publicado pero stock 0 (AC-4).
  const s0 = await crear({ stock: 0, image_url: 'https://example.com/x.jpg' });
  const sinStock = await publicar(s0.id);

  // Sin imagen: `image_url` ausente → placeholder en el FE (AC-6).
  const si = await crear({ stock: 3 });
  const sinImagen = await publicar(si.id);

  // Draft: se crea y NO se publica (AC-7).
  const draft = await crear({ stock: 2 });

  // Archivado: publicar y luego archivar — el camino real de la FSM (AC-7).
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
    publicado,
    sinStock,
    sinImagen,
    draft,
    archivado,
  };
}
