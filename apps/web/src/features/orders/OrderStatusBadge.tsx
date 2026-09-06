import type { OrderStatus } from './ordersService';
import type { PurchaseStatus } from '../order-history/orderHistoryService';

// Texto + color (nunca color como único portador de estado — a11y §11).
// preparing/ready comparten bucket de color (design-system §7.7) — el TEXTO
// los distingue. cancelled es defensivo: fuera del flujo de esta US, pero
// una orden ya cancelada por US-013 puede abrirse desde un link viejo.
// pending_payment es defensivo del mismo modo (US-020 AC-4: el 409 de
// DELETE /me reusa el mismo DTO/enum que el historial del cliente — este
// componente también lo reusa para PurchaseDetail/PurchaseHistoryList, que
// en la práctica nunca reciben pending_payment porque GET /me/orders lo
// excluye por query, no por tipo).
const LABELS: Record<
  OrderStatus | PurchaseStatus,
  { text: string; className: string }
> = {
  pending_payment: { text: 'Pendiente de pago', className: 'bg-warning-subtle text-warning' },
  new: { text: 'Nueva', className: 'bg-brand-primary-subtle text-info' },
  preparing: { text: 'Preparando', className: 'bg-warning-subtle text-warning' },
  ready: { text: 'Lista para retirar', className: 'bg-warning-subtle text-warning' },
  delivered: { text: 'Entregada', className: 'bg-success-subtle text-success' },
  cancelled: { text: 'Cancelada', className: 'bg-error-subtle text-error' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus | PurchaseStatus }) {
  const label = LABELS[status];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${label.className}`}
    >
      {label.text}
    </span>
  );
}
