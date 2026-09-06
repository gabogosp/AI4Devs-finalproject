'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { adminSession } from './adminSession';

const SECTIONS = [
  { href: '/admin/categorias', label: 'Categorías' },
  { href: '/admin/productos', label: 'Productos' },
  { href: '/admin/ordenes', label: 'Órdenes' },
  { href: '/admin/importar', label: 'Importar' },
  { href: '/admin/metricas', label: 'Métricas' },
] as const;

/**
 * Header/nav compartido de `(admin)` (A1) — el layout sólo tenía el guard, sin
 * ningún punto de navegación entre secciones ni de vuelta: quien entraba a
 * "Importar" no tenía forma de salir salvo editar la URL a mano, y
 * `adminSession.signOut()` existía desde que se construyó el login pero nunca
 * se conectó a ningún botón (cero forma de cerrar sesión desde la UI).
 *
 * Activo por prefijo (`startsWith`), no por igualdad exacta: `/admin/ordenes`
 * tiene que seguir marcado activo en `/admin/ordenes/{id}` (el detalle), igual
 * que `/admin/importar/{id}`.
 */
export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  function cerrarSesion() {
    adminSession.signOut();
    router.replace('/admin/acceso');
  }

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 p-4">
        <nav aria-label="Panel del dueño" className="flex flex-wrap gap-4">
          {SECTIONS.map((s) => {
            const active = pathname?.startsWith(s.href) ?? false;
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'text-sm font-medium focus:outline-none focus-visible:shadow-focus',
                  active ? 'text-accent-strong underline underline-offset-4' : 'text-fg',
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={cerrarSesion}
          className="text-sm text-muted hover:text-fg focus:outline-none focus-visible:shadow-focus"
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}
