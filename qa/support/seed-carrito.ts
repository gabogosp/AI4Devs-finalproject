import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { nuevoProducto } from './builders';

interface CategoriaListada {
  id: string;
  name: string;
}

/** Nombre fijo de la categoría compartida — ver `categoriaDeLaSuiteDeCarrito`. */
const CATEGORIA_COMPARTIDA = 'QA — carrito (categoría compartida, no borrar)';

/**
 * `POST /v1/admin/categories` no tiene DELETE (`categories.controller.ts` no
 * lo expone — decisión de negocio real, no un gap de esta suite) y
 * `carrito.spec.ts` corre `beforeAll` una vez por *worker* de Playwright: sin
 * reutilizar, cada corrida deja una categoría nueva y huérfana en la DB de QA,
 * para siempre.
 *
 * Encontrado real (TC-731, 2026-09-06): tras muchas corridas repetidas contra
 * la misma DB persistente, `CategoryNav` (que lista TODAS las categorías sin
 * límite, en el header de TODAS las páginas del storefront) acumuló 78
 * entradas — bastante para agotar el presupuesto de `Tab` de TC-731 antes de
 * llegar siquiera al carrito. Reproducido y confirmado: la falla no dependía
 * del bump de `next` (US-022 ya lo había descartado bien), dependía del
 * tamaño acumulado del catálogo de esta DB.
 *
 * Fix: idempotente por **nombre fijo**, no por corrida. Busca antes de crear
 * y tolera la carrera entre workers — `slug` es único (deriva del `name`
 * server-side), así que dos workers creando al mismo tiempo hacen que uno
 * reciba un `ConflictError` (409): se re-busca y se usa la que ganó la
 * carrera, en vez de fallar.
 */
async function categoriaDeLaSuiteDeCarrito(token: string): Promise<CategoriaListada> {
  const buscar = async (): Promise<CategoriaListada | undefined> => {
    const listado = await apiCall<CategoriaListada[]>(
      '/v1/admin/categories',
      'GET',
      token,
    );
    return listado.find((c) => c.name === CATEGORIA_COMPARTIDA);
  };

  const existente = await buscar();
  if (existente) return existente;

  try {
    return await apiCall<CategoriaListada>('/v1/admin/categories', 'POST', token, {
      name: CATEGORIA_COMPARTIDA,
    });
  } catch (err) {
    const esConflictoDeCarrera = err instanceof Error && /→ 409\b/.test(err.message);
    if (!esConflictoDeCarrera) throw err;
    const ganadora = await buscar();
    if (!ganadora) throw err;
    return ganadora;
  }
}

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

  const category = await categoriaDeLaSuiteDeCarrito(token);

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
