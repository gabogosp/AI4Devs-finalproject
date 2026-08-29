import { CartItemAvailability, CartView, CartViewItem } from '../cart-view';

/**
 * DTOs de respuesta del carrito — se construyen **campo por campo**.
 *
 * Nada de `{ ...item }`: un spread deja pasar cualquier campo que se agregue
 * después a la vista o a la entidad, y el día que alguien sume `stock` crudo o
 * `product_id` aparecería en la respuesta pública sin que nadie lo decida. Acá
 * agregar un campo es un acto explícito.
 *
 * Lo que **no** se expone, a propósito: `product_id` y `cart_id` (identificadores
 * internos; el identificador público del producto es el `slug`, convención de
 * US-002/US-003), `status` y `stock` crudos (el nivel de inventario se comunica
 * como `availability` + `max_quantity`, OQ-BE-2) y por supuesto ningún token — la
 * identidad del carrito viaja sólo en la cookie.
 */
export class CartItemDto {
  slug!: string;
  name!: string;
  image_url!: string | null;
  quantity!: number;
  /** Precio **vigente**, no la instantánea guardada (AC-9). */
  unit_price_ars_cents!: number;
  currency!: 'ARS';
  subtotal_ars_cents!: number;
  availability!: CartItemAvailability;
  /** Sólo cuando la línea pide más de lo que hay (AC-5/AC-6). */
  available_quantity?: number;
  /** Techo del stepper: `min(stock, CART_MAX_QTY_PER_LINE)` (OQ-BE-2). */
  max_quantity!: number;
  price_changed!: boolean;
  previous_unit_price_ars_cents?: number;

  static from(item: CartViewItem): CartItemDto {
    return {
      slug: item.slug,
      name: item.name,
      image_url: item.image_url,
      quantity: item.quantity,
      unit_price_ars_cents: item.unit_price_ars_cents,
      currency: item.currency,
      subtotal_ars_cents: item.subtotal_ars_cents,
      availability: item.availability,
      ...(item.available_quantity !== undefined
        ? { available_quantity: item.available_quantity }
        : {}),
      max_quantity: item.max_quantity,
      price_changed: item.price_changed,
      ...(item.previous_unit_price_ars_cents !== undefined
        ? {
            previous_unit_price_ars_cents: item.previous_unit_price_ars_cents,
          }
        : {}),
    };
  }
}

export class CartDto {
  /** `null` en el carrito vacío. Conocerlo NO da acceso: el acceso es la cookie. */
  id!: string | null;
  items!: CartItemDto[];
  /** Líneas distintas. */
  item_count!: number;
  /** Unidades. */
  total_quantity!: number;
  /** Suma de las líneas comprables **solamente** (OQ-BE-4). */
  total_ars_cents!: number;
  has_blocking_issues!: boolean;
  updated_at!: Date | null;

  static from(view: CartView): CartDto {
    return {
      id: view.id,
      items: view.items.map((item) => CartItemDto.from(item)),
      item_count: view.item_count,
      total_quantity: view.total_quantity,
      total_ars_cents: view.total_ars_cents,
      has_blocking_issues: view.has_blocking_issues,
      updated_at: view.updated_at,
    };
  }
}
