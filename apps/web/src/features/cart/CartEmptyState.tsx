'use client';

import Link from 'next/link';

/**
 * Estado vacío del carrito (AC-7).
 *
 * `design-system` §10.1 — no es una pantalla de error: es una invitación a seguir
 * comprando, con tono informal argentino (§10.2, «vos»). Sin resumen, sin total y
 * sin CTA al pago: no hay nada que pagar.
 */
export function CartEmptyState() {
  return (
    <div className="flex flex-col items-start gap-4 py-12">
      <h1 className="text-2xl font-semibold">Tu carrito está vacío</h1>
      <p className="text-sm text-muted">
        Todavía no agregaste nada. Mirá los rubros y encontrá lo que necesitás.
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
