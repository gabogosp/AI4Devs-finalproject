'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { productTag } from './storefrontService';

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
