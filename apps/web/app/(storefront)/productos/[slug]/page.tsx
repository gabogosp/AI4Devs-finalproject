import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProductBySlug } from '@/features/storefront/storefrontService';
import { ProductDetail } from '@/features/storefront/ProductDetail';
import { productMetadata } from '@/features/storefront/metadata';
import { isAppError } from '@/lib/http/errors';

/**
 * Metadatos por ficha (AC-2). El `fetch` de Next memoiza por URL + opciones, así
 * que esta llamada y la de la page se deduplican en un solo request.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug).catch(() => null);
  return productMetadata(product);
}

/**
 * Ficha pública de producto (US-003). Server Component: el HTML sale del
 * servidor con el contenido del producto, que es lo que indexa un buscador
 * (AC-2).
 *
 * La política de caché vive en el servicio (`storefrontService`): fetch
 * etiquetado `product:{slug}` + safety-net de 1 h, invalidado on-demand cuando
 * el dueño edita el producto en el panel (AC-9 — design.md D2).
 */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const product = await getProductBySlug(slug).catch((error: unknown) => {
    // Draft / archivado / inexistente → 404 uniforme del contrato (AC-7/AC-8).
    // `notFound()` produce un status 404 REAL, nunca un 200 vacío.
    if (isAppError(error, 'notFound')) notFound();
    throw error; // el resto sube al error boundary del segmento
  });

  return <ProductDetail product={product} />;
}
