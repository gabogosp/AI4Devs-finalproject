'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { isAppError } from '@/lib/http/errors';
import { track } from '@/lib/observability/events';
import { ordersService, type OrderDetail } from './ordersService';

/**
 * Acción "Anonimizar datos del comprador" (AC-3), confirmación de dos pasos
 * reusando `ConfirmDialog` (mismo esqueleto que
 * `apps/web/src/features/products/ProductActions.tsx` — `archive()`),
 * `frontend-standards.md` §11.bis.5.
 *
 * refetch-on-success, NO optimista — a diferencia de `OrderStatusActions`
 * (`design.md` §Approach — "Decisión explícita de shape de retorno"):
 * `POST /anonymize` responde `OrderAnonymizationResult`, no el
 * `AdminOrderDetail` completo que sí devuelve el `PATCH` de estado, así que
 * acá se pide un segundo `GET` (`ordersService.get`) en vez de mergear a
 * mano una respuesta parcial sobre el estado existente.
 */
export function OrderAnonymizeAction({
  order,
  onAnonymized,
}: {
  order: {
    id: string;
    anonymizedAt: string | null;
    anonymizationReason: 'retention_policy' | 'requested' | 'account_deletion' | null;
  };
  onAnonymized: (updated: OrderDetail) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // AC-8 (UI): ya anonimizada — la acción no se reofrece.
  if (order.anonymizedAt) return null;

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    track('order_anonymize_attempted', { order_id: order.id });
    try {
      await ordersService.anonymize(order.id);
      // refetch-on-success (no UI optimista): trae anonymized_at/
      // anonymization_reason y preserva items/status_history sin
      // reconstruirlos a mano a partir de la respuesta parcial del POST.
      const refreshed = await ordersService.get(order.id);
      setConfirmOpen(false);
      setMessage('Se anonimizaron los datos del comprador.');
      track('order_anonymize_succeeded', { order_id: order.id });
      onAnonymized(refreshed);
    } catch (err) {
      track('order_anonymize_failed', { order_id: order.id });
      setError(
        isAppError(err, 'notFound')
          ? 'La orden ya no existe.'
          : 'No se pudo anonimizar. Reintentá.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <div role="alert">{error}</div>}
      {message && <div role="status">{message}</div>}
      <Button
        variant="destructive"
        onClick={() => setConfirmOpen(true)}
        loading={busy}
      >
        Anonimizar datos del comprador
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Anonimizar datos del comprador"
        description="Se van a reemplazar el nombre, el email y el teléfono del comprador por un valor genérico. Los productos, importes, estado y fechas de la orden NO cambian. Esta acción no se puede deshacer."
        confirmWord="ANONIMIZAR"
        confirmLabel="Anonimizar"
        onConfirm={() => void confirm()}
        onCancel={() => setConfirmOpen(false)}
        busy={busy}
      />
    </div>
  );
}
