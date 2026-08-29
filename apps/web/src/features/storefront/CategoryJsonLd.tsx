import { serializeJsonLd } from './ProductJsonLd';
import { buildBreadcrumbJsonLd } from './categoryMetadata';
import type { StorefrontCategory } from './categoriesStorefrontService';

/**
 * `schema.org/BreadcrumbList` de la página de categoría (AC-4).
 *
 * Reusa `serializeJsonLd` de US-003 en vez de duplicar el escape: es el único
 * `dangerouslySetInnerHTML` admitido en la app (security-standards §6), y tener
 * una sola implementación evita que una copia se olvide del escape de `<`.
 */
export function CategoryJsonLd({ category }: { category: StorefrontCategory }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: serializeJsonLd(buildBreadcrumbJsonLd(category)),
      }}
    />
  );
}
