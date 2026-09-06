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

  // AC-7 (UI): entregada o cancelada — NO se vuelve a OFRECER la acción
  // (estado terminal). A diferencia de un `return null` incondicional
  // (bug encontrado por QA-013-E2E-3): cancelar deja la orden en
  // `cancelled` — el propio resultado exitoso volvería terminal este gate
  // en el mismo render que muestra el mensaje, y un `return null` temprano
  // desmontaría el `<div>` del mensaje antes de pintarlo. El gate sólo
  // oculta el botón/diálogo de una NUEVA cancelación; el banner de
  // resultado de la última acción, si lo hay, se sigue renderizando.
  const puedeOfrecerse = order.status !== 'delivered' && order.status !== 'cancelled';
  // Sin nada que ofrecer NI nada que reportar (p.ej. se navegó directo al
  // detalle de una orden ya terminal, sin haberla cancelado desde acá):
  // no renderiza nada, mismo comportamiento externo que antes del fix.
  if (!puedeOfrecerse && !message && !error) return null;

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
      {puedeOfrecerse && (
        <>
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
        </>
      )}
    </div>
  );
}
