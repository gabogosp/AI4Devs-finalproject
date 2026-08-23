'use client';

import { Button } from '@/components/ui/Button';
import { formatArs } from '@/lib/format/currency';
import type { Cart } from '@/api/generated/model';

/**
 * Motivo por el que el pago no está disponible. Los dos son **distinguibles** a
 * propósito: uno lo resuelve la persona (ajustando su carrito), el otro no
 * depende de ella (la pantalla de pago todavía no existe).
 */
const MOTIVO_BLOQUEO =
  'Revisá los productos marcados antes de seguir: hay líneas que no se pueden comprar.';
const MOTIVO_PENDIENTE = 'El pago se habilita en la próxima entrega.';

export interface CartSummaryProps {
  cart: Cart;
  /**
   * `/checkout` todavía no existe (US-008). Cuando exista, este flag desaparece
   * junto con `MOTIVO_PENDIENTE`.
   * `Deferred: US-008 — owner: FE`.
   */
  checkoutAvailable?: boolean;
  onCheckout?: () => void;
}

/**
 * Resumen del carrito: total + CTA al pago.
 *
 * El total se muestra **tal como lo calculó el servidor** — que suma sólo las
 * líneas comprables (OQ-BE-4), porque un total que incluyera lo no comprable es
 * un número que el checkout va a desmentir.
 *
 * El contenedor del total es una región `aria-live="polite"`: recalcularlo tiene
 * que anunciarse sin interrumpir a quien está navegando.
 */
export function CartSummary({
  cart,
  checkoutAvailable = false,
  onCheckout,
}: CartSummaryProps) {
  const bloqueado = cart.has_blocking_issues;
  const motivo = bloqueado
    ? MOTIVO_BLOQUEO
    : checkoutAvailable
      ? null
      : MOTIVO_PENDIENTE;

  return (
    <section
      aria-labelledby="resumen-carrito"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="resumen-carrito" className="text-base font-semibold">
        Resumen
      </h2>

      {/* El total se anuncia al recalcularse, sin interrumpir (§D8). */}
      <div aria-live="polite" className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">Total</span>
        <span className="text-xl font-semibold">{formatArs(cart.total_ars_cents)}</span>
      </div>
      <p className="text-xs text-muted">IVA incluido</p>

      <Button
        variant="accent"
        disabled={bloqueado || !checkoutAvailable}
        onClick={onCheckout}
      >
        Ir al pago
      </Button>

      {/* El motivo va SIEMPRE a la vista: un botón deshabilitado y mudo erosiona
          la confianza — no se sabe si es un error propio o del sitio. */}
      {motivo && <p className="text-xs text-gray-600">{motivo}</p>}

      <p className="text-xs text-muted">Retirás en el local: Av. Córdoba y Av. Pueyrredón.</p>
    </section>
  );
}
