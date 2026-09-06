import type { AdminOrderStatusChange } from '@/api/generated/model';
import { formatDateTime } from '@/lib/format/datetime';
import { STATUS_LABEL } from './orderStatus';
import type { FulfillmentStatus } from './ordersService';

/** Traduce a label en español; si el valor no está en el mapa (caso raro,
 * fila mezclada de otro módulo), muestra el valor crudo antes que romper.
 *
 * `cancelled` no vive en `STATUS_LABEL` (deliberado, `orderStatus.ts` — ese
 * mapa es sólo de transiciones de fulfillment) pero SÍ es un `to_status` real
 * y frecuente acá desde US-013 (cada cancelación agrega una fila con
 * `to_status: 'cancelled'`) — traducido acá, en el único lugar de este
 * componente que necesita el quinto valor de `OrderStatus`. */
function label(status: string | null): string {
  if (status === null) return '—';
  if (status === 'cancelled') return 'Cancelada';
  return STATUS_LABEL[status as FulfillmentStatus] ?? status;
}

/**
 * Audit trail del detalle (AC-9, `design.md` §D8). `changed_by` se omite
 * (no un placeholder vacío) cuando es `null`.
 */
export function OrderStatusHistory({ entries }: { entries: AdminOrderStatusChange[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {entries.map((entry, i) => (
        <li key={i}>
          {label(entry.from_status)} → {label(entry.to_status)}
          {' · '}
          {formatDateTime(entry.changed_at)}
          {entry.changed_by ? ` · cambiado por ${entry.changed_by}` : ''}
        </li>
      ))}
    </ul>
  );
}
