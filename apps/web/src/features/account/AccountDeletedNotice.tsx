'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

/**
 * Pantalla de confirmación post-borrado (US-020 AC-2/AC-11), montada por
 * `MiCuentaScreen` en reemplazo de `CustomerGuard`/`AccountPanel` (design.md
 * §D3) — NO vive dentro del árbol que el guard protege.
 *
 * `role="status"` `aria-live="polite"`: es una confirmación, no una
 * interrupción (a diferencia de `role="alert"`). Foco al propio
 * `<h2 tabIndex={-1}>` al montar (design-system §11 — foco gestionado al
 * cambiar de contenido). No renderiza ningún dato del cliente borrado
 * (AC-2, superficie): sólo el mensaje genérico.
 */
export function AccountDeletedNotice() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">
        Tu cuenta fue eliminada
      </h2>
      <p className="text-sm text-muted">
        Fue inmediato y no se puede deshacer. Tu email queda libre: podés
        volver a registrarte cuando quieras. Tu historial de compras se
        conserva, pero sin datos que te identifiquen.
      </p>
      <Link
        href="/"
        className="self-start text-sm underline focus:outline-none focus-visible:shadow-focus"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
