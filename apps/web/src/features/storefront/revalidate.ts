'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { productTag } from './storefrontService';
import { CATALOG_TAG } from './categoriesStorefrontService';

/**
 * Una Server Action es una superficie invocable desde afuera: se valida el
 * input como el de cualquier endpoint público (next-standards §4). El slug es
 * kebab-case, igual que el `pattern` del contrato.
 */
const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/**
 * Invalida la ficha pública de un producto (AC-9, design.md D2).
 *
 * Se invalidan **dos** cachés distintas y ambas hacen falta:
 * - `revalidateTag` tira la Data Cache del fetch del producto.
 * - `revalidatePath` tira la Full Route Cache, que es lo que cubre el caso
 *   "la ficha quedó cacheada como 404 y el dueño recién publica el producto" —
 *   ahí no hay tag que invalidar porque nunca hubo respuesta exitosa.
 *
 * El efecto es idempotente y benigno: invalidar de más sólo provoca un re-fetch.
 */
export async function revalidateProduct(rawSlug: string): Promise<void> {
  const slug = slugSchema.parse(rawSlug);

  revalidateTag(productTag(slug));
  revalidatePath(`/productos/${slug}`);
}

/**
 * Invalida TODO el catálogo público: navegación, listados, fichas y sitemap
 * (AC-8, design.md D2).
 *
 * Sin input → nada que validar; el efecto es idempotente y benigno (purgar de
 * más sólo provoca un re-fetch), a diferencia de `revalidateProduct`, que sí
 * recibe un slug del exterior.
 *
 * Las cinco purgas cubren cosas distintas y ninguna sobra:
 * - `revalidateTag(CATALOG_TAG)` tira la Data Cache del árbol, los detalles,
 *   los listados y el sitemap, que comparten tag.
 * - `revalidatePath('/categorias/[slug]', 'page')` tira la Full Route Cache de
 *   **todas** las instancias del segmento dinámico — incluidos los 404
 *   cacheados, que es el caso "la categoría recién creada seguía dando 404" y
 *   que ningún tag puede cubrir porque nunca hubo respuesta exitosa.
 * - `revalidatePath('/productos/[slug]', 'page')` es el mismo argumento que la
 *   línea de arriba pero para las fichas: tirar sólo el tag no alcanza para
 *   forzar el re-render de la Full Route Cache de una ficha ya servida
 *   estáticamente, y un import masivo (US-006) puede tocar cientos de SKUs a
 *   la vez — no hay slug por slug que invalidar uno por uno. Sin esta línea,
 *   un ajuste de precios masivo deja las fichas ya cacheadas sirviendo el
 *   precio viejo hasta el safety-net de 1h (defecto encontrado en el E2E de
 *   US-006, TC-619).
 * - `revalidatePath('/')` refresca la grilla de rubros de la home.
 * - `revalidatePath('/sitemap.xml')` porque el sitemap es una ruta cacheada más.
 */
export async function revalidateCatalog(): Promise<void> {
  revalidateTag(CATALOG_TAG);
  revalidatePath('/categorias/[slug]', 'page');
  revalidatePath('/productos/[slug]', 'page');
  revalidatePath('/');
  revalidatePath('/sitemap.xml');
}
