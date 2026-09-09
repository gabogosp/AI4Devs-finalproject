export interface OrderReadyForPickupPayload {
  orderId: string;
  orderNumber: number;
  buyerName: string;
  buyerEmail: string;
}

export interface OrderConfirmedItem {
  productName: string;
  quantity: number;
  unitPriceArsCents: number;
}

export interface OrderConfirmedPayload {
  orderId: string;
  orderNumber: number;
  buyerName: string;
  buyerEmail: string;
  /** US-011 AC-1 — detalle de ítems para el email de confirmación. */
  items: OrderConfirmedItem[];
  /** US-011 AC-1 — total para el email de confirmación. */
  totalArsCents: number;
}

export interface OwnerNewOrderPayload {
  orderId: string;
  orderNumber: number;
  totalArsCents: number;
}

export interface OrderReceivedItem {
  productName: string;
  quantity: number;
  unitPriceArsCents: number;
}

/**
 * Resumen de compra al cliente, al CREAR la orden (checkout, `pending_payment`)
 * — distinto de `OrderConfirmedPayload` (pago confirmado, sólo providers
 * automáticos). Mismas 6 propiedades porque el resumen necesita lo mismo
 * (items + total), pero el momento y el wording son otros.
 */
export interface OrderReceivedPayload {
  orderId: string;
  orderNumber: number;
  buyerName: string;
  buyerEmail: string;
  items: OrderReceivedItem[];
  totalArsCents: number;
}

export interface OrderCancelledNoStockPayload {
  orderId: string;
  orderNumber: number;
  buyerName: string;
  buyerEmail: string;
}

export interface OrderCancelledByOwnerPayload {
  orderId: string;
  orderNumber: number;
  buyerName: string;
  buyerEmail: string;
}

/**
 * Seam para los avisos del ciclo de vida de la orden. Un solo puerto —
 * `per backend-node-standards.md §3`, mismo estilo de puerto por token de DI
 * que los del catálogo. El adapter real (envío por Resend) es US-011; este
 * change (US-010) sólo garantiza que los triggers nuevos se invocan en el
 * momento correcto (AC-1, AC-4).
 */
export interface NotificationPort {
  orderReadyForPickup(payload: OrderReadyForPickupPayload): Promise<void>;
  /** Pago confirmado (AC-1) — sólo para providers automáticos (`mercadopago`/`simulated_dsm`). */
  orderConfirmed(payload: OrderConfirmedPayload): Promise<void>;
  /** Aviso al dueño de una orden nueva confirmada (AC-1). */
  ownerNewOrder(payload: OwnerNewOrderPayload): Promise<void>;
  /** La orden se canceló automáticamente por falta de stock tras un pago aprobado (AC-4). */
  orderCancelledNoStock(payload: OrderCancelledNoStockPayload): Promise<void>;
  /** El dueño canceló manualmente una orden pagada no entregada (US-013 AC-4). */
  orderCancelledByOwner(payload: OrderCancelledByOwnerPayload): Promise<void>;
  /**
   * Resumen de compra al cliente, al crear la orden en el checkout —
   * `pending_payment`, ANTES de cualquier confirmación de pago. El disparador
   * real hoy (MercadoPago diferido, coordinación por WhatsApp): distinto de
   * `orderConfirmed`, que asume pago ya confirmado.
   */
  orderReceived(payload: OrderReceivedPayload): Promise<void>;
  /**
   * Aviso al dueño de una orden nueva RECIBIDA (no necesariamente pagada) —
   * mismo momento que `orderReceived`, para que el dueño coordine por
   * WhatsApp sin esperar una confirmación automática que hoy no llega.
   */
  ownerOrderReceived(payload: OwnerNewOrderPayload): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
