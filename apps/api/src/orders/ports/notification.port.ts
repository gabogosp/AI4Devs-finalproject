export interface OrderReadyForPickupPayload {
  orderId: string;
  orderNumber: number;
  buyerName: string;
  buyerEmail: string;
}

/**
 * Seam para el aviso de "lista para retirar" (AC-4). Un solo método —
 * `per backend-node-standards.md §3`, mismo estilo de puerto por token de DI
 * que los del catálogo. El adapter real (envío por Resend) es US-011; este
 * change sólo garantiza que el trigger se invoca en el momento correcto.
 */
export interface NotificationPort {
  orderReadyForPickup(payload: OrderReadyForPickupPayload): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
