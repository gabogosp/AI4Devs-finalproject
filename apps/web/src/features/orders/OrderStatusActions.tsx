'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { isAppError } from '@/lib/http/errors';
import { ordersService, type OrderDetail, type OrderStatus } from './ordersService';
import { ACTION_LABEL, NEXT_STATUS } from './orderStatus';

/**
 * UI optimista + rollback (design.md §D7, `frontend-resilience-patterns` #3,
 * #4, #9). Un solo botón — el de `NEXT_STATUS[order.status]` — nunca un menú
 * que ofrezca un salto inválido (AC-6). `cancelled` no tiene next: no se
 * renderiza ningún botón (fuera del flujo de esta US).
 */
export function OrderStatusActions({
  order,
  onOptimisticUpdate,
  onConfirmed,
}: {
  order: { id: string; status: OrderStatus };
  onOptimisticUpdate: (status: OrderStatus) => void;
  onConfirmed: (order: OrderDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const next = order.status === 'cancelled' ? null : NEXT_STATUS[order.status];

  async function advance() {
    if (!next || busy) return;
    const key = idempotencyKeyRef.current ?? (idempotencyKeyRef.current = crypto.randomUUID());
    setBusy(true);
    setError(null);
    const previous = order.status;
    onOptimisticUpdate(next); // 1. optimista — el badge cambia YA
    try {
      const updated = await ordersService.updateStatus(order.id, next, key);
      idempotencyKeyRef.current = null; // intento cerrado — el próximo click es un intento nuevo
      onConfirmed(updated); // 2. reconcilia con lo que el backend confirmó
      if (next === 'ready') {
        setMessage('Se avisó al cliente que su pedido está listo.');
      } else {
        setMessage(null);
      }
    } catch (err) {
      onOptimisticUpdate(previous); // 3. rollback — el backend no confirmó
      setError(
        isAppError(err, 'conflict')
          ? 'La orden ya cambió de estado (probablemente en otra pestaña). Recargá para ver el estado actual.'
          : 'No se pudo actualizar el estado. Reintentá.',
      );
      // idempotencyKeyRef NO se limpia: un reintento manual reusa la misma clave (patrón #9)
    } finally {
      setBusy(false);
    }
  }

  if (!next) return null;

  return (
    <div className="flex flex-col gap-2">
      {error && <div role="alert">{error}</div>}
      {message && <div role="status">{message}</div>}
      <Button onClick={() => void advance()} loading={busy}>
        {ACTION_LABEL[next]}
      </Button>
    </div>
  );
}
