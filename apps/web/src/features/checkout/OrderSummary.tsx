import { formatArs } from '@/lib/format/currency';
import type { Cart } from '@/api/generated/model';

export interface OrderSummaryProps {
  cart: Cart;
}

/**
 * Resumen del pedido (AC-2): ítems + total del **carrito ya cargado**, nunca
 * recalculado acá (`api-standards.md` §5.5 — el servidor es la única
 * autoridad). Una vez creada la orden, `CheckoutConfirmation` muestra el total
 * del 201 — éste es el de ANTES de confirmar (`design.md` D9).
 *
 * Sólo líneas `available`: las bloqueadas ya las filtró `CheckoutBlocked`
 * (T3.4) — no se duplica el detalle acá.
 */
export function OrderSummary({ cart }: OrderSummaryProps) {
  const disponibles = cart.items.filter((item) => item.availability === 'available');

  return (
    <section aria-labelledby="resumen-pedido" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 id="resumen-pedido" className="text-base font-semibold">
        Tu pedido
      </h2>
      <ul className="flex flex-col gap-2">
        {disponibles.map((item) => (
          <li key={item.slug} className="flex items-baseline justify-between gap-2 text-sm">
            <span>
              {item.name} <span className="text-muted">× {item.quantity}</span>
            </span>
            <span>{formatArs(item.subtotal_ars_cents)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-2 border-t border-border pt-2">
        <span className="text-sm text-muted">Total</span>
        <span className="text-xl font-semibold">{formatArs(cart.total_ars_cents)}</span>
      </div>
      <p className="text-xs text-muted">IVA incluido</p>
    </section>
  );
}
