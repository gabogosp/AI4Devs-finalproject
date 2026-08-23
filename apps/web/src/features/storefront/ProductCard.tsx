import Link from 'next/link';
import { formatArs } from '@/lib/format/currency';
import { ProductImage } from './ProductImage';
import { AddToCartButton } from '@/features/cart/AddToCartButton';
import type { StorefrontProductListItem } from '@/api/generated/model';

/**
 * Tarjeta de producto en la grilla de una categoría (AC-3).
 *
 * Server Component: el único trozo interactivo propio es el botón de agregar, que
 * es un Client Component hoja (US-007 T3.5, OQ-FE-2 resuelta como «sí»).
 *
 * **El link a la ficha sigue siendo el elemento principal**, pero ya no envuelve
 * la tarjeta entera: un `<button>` dentro de un `<a>` es HTML inválido y anida dos
 * elementos interactivos, así que un lector de pantalla y el teclado quedarían con
 * dos destinos compitiendo. La estructura pasa a ser `article` → link (imagen,
 * nombre, precio) + botón hermano.
 *
 * **Sin stock no hay control de compra** (AC-5 de US-002 sigue en pie): el badge
 * explica por qué, con texto y no sólo con color.
 */
export function ProductCard({
  item,
  categoryName,
}: {
  item: StorefrontProductListItem;
  categoryName: string;
}) {
  return (
    <article className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md">
      <Link
        href={`/productos/${item.slug}`}
        className="flex flex-1 flex-col gap-3 focus:outline-none focus-visible:shadow-focus"
      >
        <ProductImage
          src={item.image_url}
          name={item.name}
          categoryName={categoryName}
          variant="card"
        />
        {/* Jerarquía del design-system §7.3: imagen → nombre → precio → disponibilidad. */}
        <h3 className="line-clamp-2 text-sm font-medium text-foreground transition-colors group-hover:text-accent-strong">
          {item.name}
        </h3>
        <div className="mt-auto flex flex-col gap-1">
          <p className="text-xl font-bold tabular-nums text-foreground">
            {formatArs(item.price_ars_cents)}
          </p>
          <p className="text-xs text-gray-600">IVA incluido</p>
          {!item.in_stock && (
            // Badge con TEXTO: el color nunca es el único portador de significado
            // (design-system §7.7 / WCAG 2.1 AA).
            <span className="mt-1 self-start rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
              Sin stock
            </span>
          )}
        </div>
      </Link>

      {item.in_stock && (
        // Una unidad y sin stepper: el stepper vive en el carrito y en la ficha.
        // El nombre accesible incluye el producto porque en una grilla hay muchos
        // «Agregar» y un lector de pantalla no podría distinguirlos.
        <AddToCartButton
          slug={item.slug}
          productName={item.name}
          variant="secondary"
          label={`Agregar ${item.name}`}
          className="w-full"
        />
      )}
    </article>
  );
}
