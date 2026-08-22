import Link from 'next/link';
import { formatArs } from '@/lib/format/currency';
import { ProductImage } from './ProductImage';
import type { StorefrontProductListItem } from '@/api/generated/model';

/**
 * Tarjeta de producto en la grilla de una categoría (AC-3).
 *
 * Server Component: no tiene interacción propia. **Toda** la card es un único
 * link a la ficha, así que el nombre accesible del link es el del producto y no
 * hay dos destinos compitiendo dentro de la misma tarjeta.
 *
 * **No lleva ningún control de compra** (AC-5 por construcción): la CTA
 * "Agregar" es `Deferred: US-007` (design.md D8). Un producto sin stock se ve,
 * con su badge, pero no hay nada que apretar para comprarlo — ni con stock.
 */
export function ProductCard({
  item,
  categoryName,
}: {
  item: StorefrontProductListItem;
  categoryName: string;
}) {
  return (
    <Link
      href={`/productos/${item.slug}`}
      className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:shadow-focus"
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
  );
}
