'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from './SessionProvider';
import { COPY_RED } from './authCopy';

/**
 * Guard de las pantallas de cuenta (US-014 T2.6).
 *
 * Es **UX, no autoridad**: quien decide es el backend, que responde 401 sin
 * cookie válida. Esto sólo evita mostrar una pantalla que no corresponde y
 * mandar al login con el destino puesto. Alguien que desactive el JavaScript no
 * "burla" nada: no hay datos que mostrar porque los datos vienen del servidor.
 *
 * **No reutiliza `AdminGuard`** (design.md D8): son dos actores distintos con
 * dos modelos de sesión distintos —cookie contra Bearer— y colapsarlos haría
 * que un cambio en el panel pudiera abrir o cerrar la puerta del storefront.
 */
export function CustomerGuard({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.kind === 'anonymous') {
      router.replace(`/ingresar?next=${encodeURIComponent(pathname)}`);
    }
  }, [state.kind, router, pathname]);

  if (state.kind === 'unknown' || state.kind === 'authenticating') {
    return (
      <p role="status" className="p-4 text-sm text-muted">
        Cargando tu cuenta…
      </p>
    );
  }

  if (state.kind === 'error') {
    // No se redirige: no sabemos si hay sesión, y mandar al login sería
    // afirmar que no la hay.
    return (
      <p role="alert" className="p-4 text-sm text-error">
        {COPY_RED}
      </p>
    );
  }

  if (state.kind === 'anonymous') {
    // Ni un fragmento de los datos mientras la redirección ocurre.
    return null;
  }

  return <>{children}</>;
}
