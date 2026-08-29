/**
 * Vista del carrito — función **pura**: precio vigente, disponibilidad y totales.
 *
 * Sin tipos de framework y sin acceso a base (`backend-node-standards.md` §2), para
 * poder ejercer las reglas de precio y stock —que son las que tienen dinero
 * adentro— sin HTTP ni Postgres.
 *
 * Las dos reglas que gobiernan todo el archivo:
 *
 * 1. **Todo importe se calcula con `product.price_ars_cents`** (el vigente, leído en
 *    la misma request, AC-9). La instantánea `item.unit_price_ars_cents` **no
 *    participa de ninguna suma**: su único uso es prender `price_changed` cuando
 *    difiere, para que el cambio sea visible y no silencioso.
 * 2. **Las líneas bloqueadas no se borran, se marcan** (AC-6), y **no suman** al
 *    total (OQ-BE-4): un total que incluye lo que no se puede comprar es un número
 *    que el checkout va a desmentir.
 */

/** Estados de una línea. `available` es el único que suma al total. */
export type CartItemAvailability =
  | 'available'
  | 'insufficient_stock'
  | 'unavailable';

/** Línea persistida (`cart_items`) — sólo lo que la vista necesita. */
export interface CartViewItemInput {
  product_id: string;
  quantity: number;
  /** Instantánea del precio al último toque. NUNCA entra en una suma. */
  unit_price_ars_cents: number;
  created_at: Date;
}

/** Carrito persistido con sus líneas. `null` es el carrito vacío (AC-7). */
export interface CartViewInput {
  id: string;
  updated_at: Date;
  items: CartViewItemInput[];
}

/** Producto vigente (`products`), tal como lo devuelve `findManyBySlugs`. */
export interface CartViewProduct {
  id: string;
  slug: string;
  name: string;
  image_url: string | null;
  price_ars_cents: number;
  stock: number;
  status: string;
}

export interface CartViewLimits {
  /** `CART_MAX_QTY_PER_LINE` — techo del stepper junto con el stock. */
  maxQtyPerLine: number;
}

export interface CartViewItem {
  slug: string;
  name: string;
  image_url: string | null;
  quantity: number;
  /** Precio **vigente**, no la instantánea. */
  unit_price_ars_cents: number;
  currency: 'ARS';
  subtotal_ars_cents: number;
  availability: CartItemAvailability;
  /** Sólo cuando la línea pide más de lo que hay. */
  available_quantity?: number;
  max_quantity: number;
  price_changed: boolean;
  previous_unit_price_ars_cents?: number;
}

export interface CartView {
  /** `null` en el carrito vacío: no hay recurso todavía, y eso es un 200 (AC-7). */
  id: string | null;
  items: CartViewItem[];
  /** Líneas distintas. */
  item_count: number;
  /** Unidades, incluidas las de las líneas bloqueadas (es lo que hay adentro). */
  total_quantity: number;
  /** Suma de los subtotales de las líneas `available` **solamente** (OQ-BE-4). */
  total_ars_cents: number;
  has_blocking_issues: boolean;
  updated_at: Date | null;
}

export const CARRITO_VACIO: CartView = {
  id: null,
  items: [],
  item_count: 0,
  total_quantity: 0,
  total_ars_cents: 0,
  has_blocking_issues: false,
  updated_at: null,
};

function disponibilidad(
  producto: CartViewProduct,
  quantity: number,
): CartItemAvailability {
  if (producto.status !== 'published') return 'unavailable';
  return producto.stock >= quantity ? 'available' : 'insufficient_stock';
}

/**
 * Arma la vista del carrito.
 *
 * Recibe el carrito con sus líneas (y no sólo las líneas) porque la respuesta
 * necesita también `id` y `updated_at`; `null` produce el carrito vacío, así el
 * caso de AC-7 vive en un solo lugar en vez de repetirse en cada llamador.
 *
 * Una línea cuyo producto no aparezca en `products` se omite: no puede pasar —la FK
 * es `ON DELETE RESTRICT`, un producto con línea viva no se borra— y sin producto no
 * hay nombre, slug ni precio con los que armar la línea.
 */
export function buildCartView(
  cart: CartViewInput | null,
  products: CartViewProduct[],
  limits: CartViewLimits,
): CartView {
  if (!cart) return { ...CARRITO_VACIO };

  const porId = new Map(products.map((p) => [p.id, p]));

  const items: CartViewItem[] = cart.items
    .filter((item) => porId.has(item.product_id))
    .sort(
      (a, b) =>
        a.created_at.getTime() - b.created_at.getTime() ||
        porId.get(a.product_id)!.slug.localeCompare(porId.get(b.product_id)!.slug),
    )
    .map((item) => {
      const producto = porId.get(item.product_id)!;
      const vigente = producto.price_ars_cents;
      const estado = disponibilidad(producto, item.quantity);
      const cambio = item.unit_price_ars_cents !== vigente;

      return {
        slug: producto.slug,
        name: producto.name,
        image_url: producto.image_url,
        quantity: item.quantity,
        unit_price_ars_cents: vigente,
        currency: 'ARS' as const,
        // También en las líneas bloqueadas: el FE muestra el detalle completo
        // aunque el importe no entre en el total.
        subtotal_ars_cents: vigente * item.quantity,
        availability: estado,
        ...(estado === 'insufficient_stock'
          ? { available_quantity: producto.stock }
          : {}),
        max_quantity: Math.min(producto.stock, limits.maxQtyPerLine),
        price_changed: cambio,
        ...(cambio
          ? { previous_unit_price_ars_cents: item.unit_price_ars_cents }
          : {}),
      };
    });

  return {
    id: cart.id,
    items,
    item_count: items.length,
    total_quantity: items.reduce((suma, i) => suma + i.quantity, 0),
    total_ars_cents: items
      .filter((i) => i.availability === 'available')
      .reduce((suma, i) => suma + i.subtotal_ars_cents, 0),
    has_blocking_issues: items.some((i) => i.availability !== 'available'),
    updated_at: cart.updated_at,
  };
}
