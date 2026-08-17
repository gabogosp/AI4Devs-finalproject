import { formatArs } from '@/lib/format/currency';
import type { StorefrontProduct } from './storefrontService';

/**
 * Ficha de producto (PDP). Server Component: el contenido llega en el HTML del
 * servidor para que Google lo indexe (AC-2).
 *
 * Jerarquía de lectura del design-system §7.3: imagen → nombre → precio →
 * disponibilidad → CTA.
 */
export function ProductDetail({ product }: { product: StorefrontProduct }) {
  return (
    <article className="mx-auto flex max-w-5xl flex-col gap-6 p-4 lg:flex-row lg:gap-10 lg:p-8">
      <div className="flex w-full flex-col gap-4 lg:w-1/2">
        <h1 className="text-2xl font-bold text-foreground lg:text-3xl">
          {product.name}
        </h1>

        <div>
          <p className="text-3xl font-bold text-foreground">
            {formatArs(product.price_ars_cents)}
          </p>
          <p className="text-xs text-gray-500">IVA incluido</p>
        </div>
      </div>
    </article>
  );
}
