import type { Metadata } from 'next';
import { publicEnv } from '@/lib/env';
import type { StorefrontCategory } from './categoriesStorefrontService';

const SITE_NAME = 'DSM Refrigeración y Ferretería';

/** URL pública canónica de una categoría — absoluta, como exigen los buscadores. */
export function categoryUrl(slug: string, page = 1): string {
  const base = `${publicEnv.NEXT_PUBLIC_SITE_URL}/categorias/${slug}`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

/**
 * Metadatos de una página de categoría (`frontend-next-standards` §6 — Metadata
 * API, nunca `<head>` manual). Función pura para poder testearla aparte.
 *
 * `category: null` es el caso 404: metadatos mínimos en vez de explotar, porque
 * `generateMetadata` corre antes de que `notFound()` haga lo suyo.
 */
export function categoryMetadata(
  category: StorefrontCategory | null,
  page = 1,
): Metadata {
  if (!category) return { title: `Categoría no encontrada — ${SITE_NAME}` };

  const url = categoryUrl(category.slug, page);
  const title =
    page === 1
      ? `${category.name} — ${SITE_NAME}`
      : `${category.name} — Página ${page} — ${SITE_NAME}`;
  const description = `Comprá ${category.name.toLowerCase()} en ${SITE_NAME}. Retirá en nuestro local de CABA.`;

  return {
    title,
    description,
    // Canonical AUTO-referencial: apuntar todas las páginas a la 1 des-indexaría
    // los productos de la página 2 en adelante — la mayoría del catálogo.
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title: category.name,
      description,
      url,
    },
  };
}

/**
 * `schema.org/BreadcrumbList` para la ruta de navegación (AC-4).
 *
 * Los nombres de categoría los escribe el dueño desde el panel → input NO
 * confiable. Se serializa con el mismo escape que `ProductJsonLd`
 * (`serializeJsonLd`), porque `</script>` dentro de un string cerraría la
 * etiqueta (security-standards §6).
 */
export function buildBreadcrumbJsonLd(category: StorefrontCategory) {
  const items = [
    { name: 'Inicio', url: publicEnv.NEXT_PUBLIC_SITE_URL },
    ...(category.parent
      ? [{ name: category.parent.name, url: categoryUrl(category.parent.slug) }]
      : []),
    { name: category.name, url: categoryUrl(category.slug) },
  ];

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
