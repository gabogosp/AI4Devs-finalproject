import type { OrderStatus } from './ordersService';

// Texto + color (nunca color como único portador de estado — a11y §11).
// preparing/ready comparten bucket de color (design-system §7.7) — el TEXTO
// los distingue. cancelled es defensivo: fuera del flujo de esta US, pero
// una orden ya cancelada por US-013 puede abrirse desde un link viejo.
const LABELS: Record<OrderStatus, { text: string; className: string }> = {
  new: { text: 'Nueva', className: 'bg-brand-primary-subtle text-info' },
  preparing: { text: 'Preparando', className: 'bg-warning-subtle text-warning' },
  ready: { text: 'Lista para retirar', className: 'bg-warning-subtle text-warning' },
  delivered: { text: 'Entregada', className: 'bg-success-subtle text-success' },
  cancelled: { text: 'Cancelada', className: 'bg-error-subtle text-error' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const label = LABELS[status];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${label.className}`}
    >
      {label.text}
    </span>
  );
}
