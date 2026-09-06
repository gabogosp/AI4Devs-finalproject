'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { isAppError } from '@/lib/http/errors';
import { formatArs } from '@/lib/format/currency';
import { track } from '@/lib/observability/events';
import { accountService } from './accountService';
import { useSession } from './SessionProvider';

/**
 * US-020 D2/D6: lookup LOCAL a esta feature, con `string` como llave y
 * fallback explícito — no se reusa `OrderStatusBadge` (su prop `status` está
 * tipada al enum ADMIN de 5 valores, sin `pending_payment`; pasarle un valor
 * real sería un error de compilación).
 */
const BLOCKING_STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  new: 'Nueva',
  preparing: 'Preparando',
  ready: 'Lista para retirar',
};

/**
 * Botón destructivo "Eliminar mi cuenta" + `ConfirmDialog` reusado (US-020
 * AC-1/AC-7/AC-11), mismo esqueleto que `OrderAnonymizeAction`/
 * `OrderCancelAction` (`frontend-standards` §11.bis.5).
 *
 * AC-9 se cumple por AUSENCIA: este componente no hace ningún `GET` previo
 * para decidir si mostrar el botón — siempre lo muestra, y deja que el
 * propio `DELETE` (y su eventual 409) sea la única fuente de verdad
 * (`design.md` §D5).
 */
export function DeleteAccountSection({ onDeleted }: { onDeleted: () => void }) {
  const { accountDeleted } = useSession();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<
    { order_number: number; status: string; total_ars_cents: number; created_at: string }[] | null
  >(null);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    setBlocking(null);
    track('account_delete_attempted');
    try {
      await accountService.deleteAccount();
      track('account_delete_succeeded');
      // Mismo manejador síncrono, sin `await` entre medio (design.md §D3):
      // así React agrupa ambos `setState` en un solo render y
      // `MiCuentaScreen` reemplaza el árbol ANTES de que `CustomerGuard`
      // llegue a re-renderizarse con `state.kind === 'anonymous'`.
      accountDeleted();
      onDeleted();
    } catch (err) {
      // D7: a diferencia del precedente (`OrderCancelAction`/
      // `OrderAnonymizeAction`), SIEMPRE cierra — un 409 puede traer una
      // LISTA de pedidos, y atenuarla detrás del overlay es una degradación
      // real de legibilidad que el caso de una sola línea no tenía.
      setConfirmOpen(false);
      const appError = isAppError(err) ? err.appError : undefined;
      if (appError?.kind === 'conflict' && appError.blockingOrders?.length) {
        track('account_delete_blocked');
        setBlocking(appError.blockingOrders);
        setError('No podés eliminar tu cuenta mientras tengas pedidos sin retirar o sin pagar.');
      } else {
        track('account_delete_failed');
        setError('No se pudo eliminar tu cuenta. Reintentá.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-md border border-error/40 p-4">
      <h2 className="text-sm font-medium text-fg">Eliminar mi cuenta</h2>
      <p className="text-sm text-muted">
        Se borran tu nombre, tu email y tu teléfono. Tu email queda libre para
        registrarte de nuevo cuando quieras. Tu historial de compras se
        conserva, pero sin datos que te identifiquen. Es inmediato y no se
        puede deshacer.
      </p>
      {error && (
        <div role="alert" className="flex flex-col gap-2 text-sm text-error">
          <p>{error}</p>
          {blocking && (
            <ul className="flex flex-col divide-y divide-border">
              {blocking.map((o) => (
                <li
                  key={o.order_number}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span>
                    Pedido #{o.order_number} — {BLOCKING_STATUS_LABEL[o.status] ?? o.status}
                  </span>
                  <span className="tabular-nums">{formatArs(o.total_ars_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Button
        variant="destructive"
        onClick={() => setConfirmOpen(true)}
        loading={busy}
        className="self-start"
      >
        Eliminar mi cuenta
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Eliminar tu cuenta"
        description="Es inmediato y no se puede deshacer. Se borran tu nombre, tu email y tu teléfono; tu email queda libre para un nuevo registro; tu historial de compras se conserva, sin datos que te identifiquen."
        confirmWord="ELIMINAR"
        confirmLabel="Eliminar mi cuenta"
        onConfirm={() => void confirm()}
        onCancel={() => setConfirmOpen(false)}
        busy={busy}
      />
    </section>
  );
}
