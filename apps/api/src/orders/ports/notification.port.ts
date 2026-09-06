export interface OrderReadyForPickupPayload {
  orderId: string;
  orderNumber: number;
  buyerName: string;
  buyerEmail: string;
}

export interface OrderConfirmedPayload {
  orderId: string;
  orderNumber: number;
  buyerName: string;
  buyerEmail: string;
}

export interface OwnerNewOrderPayload {
  orderId: string;
  orderNumber: number;
  totalArsCents: number;
}

export interface OrderCancelledNoStockPayload {
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
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
