import { CartView } from '../cart/cart-view';

/**
 * Snapshot y total de la orden — función **pura**, igual que `cart-view.ts` de
 * US-007, para poder ejercer las reglas que tienen dinero adentro sin HTTP ni
 * Postgres (`backend-node-standards.md` §2).
 *
 * `CartView.items` trae el precio **vigente** y el nombre, pero no el
 * `product_id` ni el `sku` (el DTO del carrito los excluye a propósito —
 * `cart.dto.ts` — el identificador público del producto es el `slug`). Este
 * módulo los recupera de vuelta con el mismo `slug`, a partir de la lectura de
 * productos que `CheckoutService` ya hizo (vía `ProductsRepository`, §5) para
 * construir la vista.
 */

export interface OrderDraftProduct {
  slug: string;
  id: string;
  sku: string;
}

export interface OrderLineDraft {
  product_id: string;
  quantity: number;
  /** El precio **vigente** que la vista trae, no la instantánea del carrito. */
  unit_price_ars_cents: number;
  product_name: string;
  product_sku: string;
}

export interface OrderDraft {
  lines: OrderLineDraft[];
  totalArsCents: number;
}

/**
 * Arma el draft de la orden a partir de una `CartView` ya validada.
 *
 * Lanza si la vista está vacía o tiene `has_blocking_issues`: la función no
 * produce drafts incomprables ni siquiera si el llamador se olvida de validar
 * (AC-5/AC-6) — es un invariante interno, no el 409 que ve el cliente
 * (`CheckoutService` ya lo distingue antes de llegar acá).
 *
 * El `totalArsCents` es la suma de `quantity × unit_price_ars_cents` **de las
 * líneas del draft**, y no una copia de `view.total_ars_cents`: la orden queda
 * aritméticamente cerrada sobre sus propias líneas.
 */
export function buildOrderDraft(
  view: CartView,
  products: OrderDraftProduct[],
): OrderDraft {
  if (view.items.length === 0 || view.has_blocking_issues) {
    throw new Error(
      'No se puede armar el draft de una orden con un carrito vacío o con líneas bloqueadas',
    );
  }

  const porSlug = new Map(products.map((p) => [p.slug, p]));

  const lines: OrderLineDraft[] = view.items.map((item) => {
    const producto = porSlug.get(item.slug);
    if (!producto) {
      throw new Error(
        `Producto no encontrado al armar la orden: ${item.slug}`,
      );
    }
    return {
      product_id: producto.id,
      quantity: item.quantity,
      unit_price_ars_cents: item.unit_price_ars_cents,
      product_name: item.name,
      product_sku: producto.sku,
    };
  });

  const totalArsCents = lines.reduce(
    (suma, linea) => suma + linea.quantity * linea.unit_price_ars_cents,
    0,
  );

  return { lines, totalArsCents };
}
