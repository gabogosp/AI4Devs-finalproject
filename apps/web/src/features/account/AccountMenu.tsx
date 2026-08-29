'use client';

import Link from 'next/link';
import { useSession } from './SessionProvider';

/**
 * Entrada a la cuenta en el header del storefront (US-014 T1.3).
 *
 * Los cinco estados de la sesión se renderizan explícitamente, y dos merecen
 * explicación:
 *
 * - `unknown`/`authenticating` muestran un placeholder **del mismo ancho** que
 *   el contenido real. Sin eso el header salta cuando la sesión resuelve, que
 *   es un empujón de layout justo donde el cliente puede estar por hacer clic.
 * - `error` **no** muestra "Ingresar". No pudimos preguntar si hay sesión;
 *   decir "Ingresar" afirmaría que no la hay, y mandaría a loguearse de nuevo a
 *   alguien que sigue logueado.
 */
export function AccountMenu() {
  const { state, logout } = useSession();

  if (state.kind === 'unknown' || state.kind === 'authenticating') {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-5 w-20 animate-pulse rounded bg-border"
      />
    );
  }

  if (state.kind === 'error') {
    return (
      <span className="text-sm text-muted" role="status">
        Cuenta no disponible
      </span>
    );
  }

  if (state.kind === 'authenticated') {
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/mi-cuenta"
          className="text-sm font-medium text-fg focus:outline-none focus-visible:shadow-focus"
        >
          {state.customer.name}
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          className="text-sm text-muted underline focus:outline-none focus-visible:shadow-focus"
        >
          Cerrar sesión
        </button>
      </div>
    );
  }

  return (
    <Link
      href="/ingresar"
      className="text-sm font-medium text-fg focus:outline-none focus-visible:shadow-focus"
    >
      Ingresar
    </Link>
  );
}
