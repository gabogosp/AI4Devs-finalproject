import Link from 'next/link';
import { ProductImage } from '@/features/storefront/ProductImage';
import { AddToCartButton } from '@/features/cart/AddToCartButton';
import { formatArs } from '@/lib/format/currency';
import type { SearchResult } from './searchService';

/**
 * Tarjeta de un resultado de búsqueda (`design.md` D6).
 *
 * **No reusa `ProductCard`** aunque se parezcan: aquélla recibe
 * `StorefrontProductListItem`, que **requiere `currency`**, y `SearchResult` no
 * lo trae. Reusarla obligaría a fabricar ese campo en el cliente, que es
 * inventar datos del contrato (`frontend-standards` §3.1). Lo que sí se reusa
 * son las piezas —`ProductImage`, `formatArs`, `AddToCartButton`— y la jerarquía
 * visual de §7.3: imagen → nombre → precio → disponibilidad.
 *
 * **El `score` no se muestra.** Un 0.42 no significa nada para quien está
 * buscando un taco Fischer y expone la mecánica del ranking; el orden ya
 * comunica la relevancia.
 */
export function SearchResultCard({ result }: { result: SearchResult }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <Link
        href={`/productos/${result.slug}`}
        className="focus:outline-none focus-visible:shadow-focus"
      >
        {/* Sin `categoryName`: la búsqueda no la trae por resultado (D6). */}
        <ProductImage src={result.image_url} name={result.name} variant="card" />
        <h3 className="mt-2 text-sm font-medium leading-snug">{result.name}</h3>
      </Link>

      <p className="text-base font-semibold">
        {formatArs(result.price_ars_cents)}{' '}
        <span className="text-xs font-normal text-muted">IVA incluido</span>
      </p>

      {result.in_stock ? (
        <AddToCartButton slug={result.slug} productName={result.name} />
      ) : (
        /*
         * AC-7: el producto agotado **aparece** —que exista es información útil—
         * pero sin botón. Ausente y no deshabilitado: un botón gris invita a
         * hacer clic y no explica por qué no pasa nada. El badge es TEXTO, no
         * sólo color, porque el color solo no es un indicador accesible (§11).
         */
        <p className="text-sm font-medium text-muted">Sin stock</p>
      )}
    </article>
  );
}
