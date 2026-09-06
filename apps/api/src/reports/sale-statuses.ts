/**
 * Allowlist de estados que cuentan como "venta" (AC-8) — la misma que ya usa
 * `OrdersAdminService.list` por default para el panel de fulfillment (CAP-5,
 * US-012). `pending_payment` queda afuera por la letra literal de AC-8;
 * `cancelled` queda afuera porque una orden llega a `cancelled` sólo cuando el
 * pago automático se aprobó pero el stock ya no alcanzaba — el pago se
 * reembolsa (`pagos/requirements.md` R-10) y no es una venta real. Ver
 * `design.md` §D2 para la justificación completa.
 */
export const SALE_STATUSES = ['new', 'preparing', 'ready', 'delivered'] as const;

export type SaleStatus = (typeof SALE_STATUSES)[number];
