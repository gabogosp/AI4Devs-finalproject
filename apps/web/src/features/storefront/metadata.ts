import type { Metadata } from 'next';
import { publicEnv } from '@/lib/env';
import type { StorefrontProduct } from './storefrontService';

const SITE_NAME = 'DSM Refrigeración y Ferretería';
const DESCRIPTION_MAX = 160;

/** Imagen OG por defecto cuando el producto no tiene una (design-system §8.1). */
const OG_DEFAULT = '/og-default.png';

/** URL pública canónica de una ficha — absoluta, como exigen los buscadores. */
export function productUrl(slug: string): string {
  return `${publicEnv.NEXT_PUBLIC_SITE_URL}/productos/${slug}`;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  // Corta en el último espacio para no partir una palabra al medio.
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Metadatos de la ficha (`frontend-next-standards` §6 — Metadata API, nunca
 * `<head>` manual). Separado de la page para poder testearlo como función pura.
 *
 * `product: null` es el caso 404: devuelve metadatos mínimos en vez de explotar
 * — `generateMetadata` corre antes de que `notFound()` haga lo suyo.
 */
export function productMetadata(product: StorefrontProduct | null): Metadata {
  if (!product) return { title: `Producto no encontrado — ${SITE_NAME}` };

  const description = truncate(product.description ?? product.name, DESCRIPTION_MAX);
  const url = productUrl(product.slug);

  return {
    title: `${product.name} — ${SITE_NAME}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title: product.name,
      description,
      url,
      images: [product.image_url ?? OG_DEFAULT],
    },
  };
}
