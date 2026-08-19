import { formatArs } from '@/lib/format/currency';
import { Breadcrumb } from './Breadcrumb';
import { ProductJsonLd } from './ProductJsonLd';
import { ProductImage } from './ProductImage';
import { ProductPurchase } from './ProductPurchase';
import { ProductViewTracker } from './ProductViewTracker';
import type { StorefrontProduct } from './storefrontService';

/**
 * Ficha de producto (PDP). Server Component: el contenido llega en el HTML del
 * servidor para que Google lo indexe (AC-2).
 *
 * Jerarquía de lectura del design-system §7.3: imagen → nombre → precio →
 * disponibilidad → CTA. El orden del DOM la respeta aunque el layout sea de dos
 * columnas en desktop.
 */
export function ProductDetail({ product }: { product: StorefrontProduct }) {
  return (
    <article className="mx-auto flex max-w-5xl flex-col gap-6 p-4 lg:flex-row lg:gap-10 lg:p-8">
      <ProductJsonLd product={product} />
      <ProductViewTracker
        slug={product.slug}
        sku={product.sku}
        inStock={product.in_stock}
      />

      <div className="w-full lg:w-1/2">
        <ProductImage
          src={product.image_url}
          name={product.name}
          categoryName={product.category.name}
        />
      </div>

      <div className="flex w-full flex-col gap-5 lg:w-1/2">
        {/* La categoría deja de ser texto muerto: es el camino de vuelta al
            rubro (AC-2), y cierra el `Deferred: US-002` que dejó US-003. */}
        <Breadcrumb
          items={[
            { name: 'Inicio', href: '/' },
            {
              name: product.category.name,
              href: `/categorias/${product.category.slug}`,
            },
            { name: product.name },
          ]}
        />

        <h1 className="text-2xl font-bold text-foreground lg:text-3xl">
          {product.name}
        </h1>

        <div>
          <p className="text-3xl font-bold text-foreground">
            {formatArs(product.price_ars_cents)}
          </p>
          <p className="text-xs text-gray-500">IVA incluido</p>
        </div>

        <ProductPurchase inStock={product.in_stock} productName={product.name} />

        {product.description && (
          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-foreground">
              Descripción
            </h2>
            {/* Texto plano: la descripción la escribe el dueño (o la genera la
                IA en US-005) y nunca se interpreta como HTML. Los saltos de
                línea se respetan con whitespace-pre-line. */}
            <p className="whitespace-pre-line text-foreground">
              {product.description}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}
