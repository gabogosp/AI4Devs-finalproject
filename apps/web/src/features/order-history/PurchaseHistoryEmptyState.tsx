'use client';

import Link from 'next/link';

/**
 * Estado vacío del historial (AC-3).
 *
 * Mismo patrón estructural que `CartEmptyState` (`design.md` §Trade-offs
 * Decisión 2) — el copy es propio del dominio: una compra como invitado no
 * cuenta acá (AC-6), así que "Todavía no compraste nada" sería falso si se
 * reusara el copy del carrito tal cual.
 */
export function PurchaseHistoryEmptyState() {
  return (
    <div className="flex flex-col items-start gap-4 py-12">
      <h2 className="text-xl font-semibold">Todavía no compraste nada</h2>
      <p className="text-sm text-muted">
        Cuando hagas tu primera compra logueado, la vas a ver acá.
      </p>
      <Link
        href="/categorias"
        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-dark focus:outline-none focus-visible:shadow-focus"
      >
        Ver rubros
      </Link>
    </div>
  );
}
