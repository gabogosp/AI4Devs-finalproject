'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { isAppError } from '@/lib/http/errors';
import { track } from '@/lib/observability/events';
import { ordersService, type OrderDetail } from './ordersService';
import type { CancelOrderResponseRefundStatus } from '@/api/generated/model';

const REFUND_MESSAGE: Record<CancelOrderResponseRefundStatus, string> = {
  refunded: 'Se canceló la orden y se reintegró el pago.',
  refund_pending:
    'Se canceló la orden. El reembolso quedó en curso — el sistema lo reintenta automáticamente.',
  not_applicable: 'Se canceló la orden.',
};

/**
 * Acción "Cancelar orden" (AC-1/AC-6/AC-7), confirmación de dos pasos
 * reusando `ConfirmDialog` (mismo esqueleto que `OrderAnonymizeAction`,
 * `frontend-standards.md` §11.bis.5).
 *
 * Reconciliación DIRECTA desde `CancelOrderResponse` (self-contained,
 * `design.md` §D2/§D4) — a diferencia de `OrderAnonymizeAction`, que
 * refetchea porque su endpoint devuelve un shape parcial, este NO necesita
 * un segundo `GET`.
 */
export function OrderCancelAction({
  order,
  onCancelled,
}: {
  order: { id: string; status: OrderDetail['status'] };
  onCancelled: (updated: OrderDetail) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // AC-7 (UI): entregada o cancelada — la acción no se ofrece (estados terminales).
  if (order.status === 'delivered' || order.status === 'cancelled') return null;

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    track('order_cancel_attempted', { order_id: order.id });
    try {
      const cancelado = await ordersService.cancel(order.id);
      setConfirmOpen(false);
      setMessage(REFUND_MESSAGE[cancelado.refund.status]);
      track('order_cancel_succeeded', { order_id: order.id });
      onCancelled(cancelado);
    } catch (err) {
      track('order_cancel_failed', { order_id: order.id });
      setError(
        isAppError(err, 'conflict')
          ? 'La orden ya no puede cancelarse (por ejemplo, si ya fue entregada).'
          : isAppError(err, 'notFound')
            ? 'La orden ya no existe.'
            : 'No se pudo cancelar. Reintentá.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <div role="alert">{error}</div>}
      {message && <div role="status">{message}</div>}
      <Button variant="destructive" onClick={() => setConfirmOpen(true)} loading={busy}>
        Cancelar orden
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Cancelar orden"
        description="Se reintegra el stock de cada ítem, se gestiona el reembolso del pago y el comprador recibe un aviso por email. Esta acción no se puede deshacer."
        confirmWord="CANCELAR"
        confirmLabel="Cancelar orden"
        onConfirm={() => void confirm()}
        onCancel={() => setConfirmOpen(false)}
        busy={busy}
      />
    </div>
  );
}
