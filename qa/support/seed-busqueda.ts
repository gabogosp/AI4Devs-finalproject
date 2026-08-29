import { adminAuth } from './admin-auth';
import { apiCall } from './api';

export interface ProductoSembradoBusqueda {
  id: string;
  slug: string;
  sku: string;
  name: string;
  price_ars_cents: number;
}

export interface SeedBusqueda {
  producto: ProductoSembradoBusqueda;
}

/**
 * Siembra UN producto publicado con nombre reconocible para los E2E de
 * búsqueda (QA-004-E2E-1/2), vía la API real (misma regla que
 * `seed-categorias.ts`: nunca INSERT directo, así respeta la FSM y la
 * derivación server-side del slug).
 *
 * A diferencia de `seed-categorias.ts` (nombre aleatorio por corrida), acá el
 * NOMBRE es fijo y reconocible («Taco Fischer QA búsqueda») porque el E2E
 * necesita poder buscarlo por texto: un nombre random no es una consulta de
 * usuario reproducible. El `sku` sigue siendo único por corrida (vía
 * `QA_RUN_PREFIX`/`Date.now()`), así que re-correr no colisiona.
 *
 * Se llama inmediatamente antes del test (`test.beforeAll`), no en un seed
 * global: el catálogo de este entorno de QA es compartido entre sesiones y
 * corridas concurrentes, así que sembrar justo antes de buscar acota (no
 * elimina) la ventana de carrera contra quien esté reseteando el catálogo en
 * paralelo.
 */
export async function seedBusqueda(): Promise<SeedBusqueda> {
  const token = await adminAuth();
  const sku = `QA-BUSQUEDA-${Date.now()}`;

  const categoria = await apiCall<{ id: string }>('/v1/admin/categories', 'POST', token, {
    name: `Fijaciones QA ${Date.now()}`,
  });

  const creado = await apiCall<ProductoSembradoBusqueda>('/v1/admin/products', 'POST', token, {
    sku,
    name: 'Taco Fischer QA búsqueda',
    price_ars_cents: 320000,
    stock: 3,
    category_id: categoria.id,
  });

  const producto = await apiCall<ProductoSembradoBusqueda>(
    `/v1/admin/products/${creado.id}`,
    'PATCH',
    token,
    { status: 'published' },
  );

  return { producto };
}
