import { productUrl } from './metadata';
import type { StorefrontProduct } from './storefrontService';

/**
 * Datos estructurados `schema.org/Product` (AC-2) — lo que le permite a Google
 * mostrar precio y disponibilidad en el resultado de búsqueda.
 *
 * **Seguridad**: nombre y descripción los escribe el dueño desde el panel, así
 * que son input NO confiable. `JSON.stringify` sólo no alcanza: la secuencia
 * `</script>` dentro de un string cierra la etiqueta y todo lo que sigue se
 * interpreta como HTML. Escapar `<` como `<` lo impide y sigue siendo JSON
 * válido (security-standards §6). Éste es el ÚNICO
 * `dangerouslySetInnerHTML` permitido en la app — nunca para HTML del producto.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function buildProductJsonLd(product: StorefrontProduct) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description ?? undefined,
    image: product.image_url ?? undefined,
    sku: product.sku,
    category: product.category.name,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'ARS',
      // schema.org espera unidades decimales; el contrato viaja en centavos.
      price: (product.price_ars_cents / 100).toFixed(2),
      availability: product.in_stock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url: productUrl(product.slug),
    },
  };
}

export function ProductJsonLd({ product }: { product: StorefrontProduct }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: serializeJsonLd(buildProductJsonLd(product)),
      }}
    />
  );
}
