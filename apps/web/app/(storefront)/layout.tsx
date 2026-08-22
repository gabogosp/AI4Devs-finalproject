import type { ReactNode } from 'react';
import Link from 'next/link';
import { CategoryNav } from '@/features/storefront/CategoryNav';

/**
 * Layout del storefront público (ADR-0010: la raíz es pública).
 *
 * Wordmark + `CategoryNav` (US-002 AC-1: los rubros son navegables e
 * indexables desde cualquier página pública, incluida la ficha). El resto del
 * top-nav —buscador, carrito, cuenta— es `Deferred: US-004/US-007`.
 */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center p-4">
          <Link
            href="/"
            className="flex items-baseline gap-2 focus:outline-none focus-visible:shadow-focus"
          >
            <span className="rounded-md bg-accent-strong px-2 py-1 text-lg font-extrabold leading-none text-white">
              DSM
            </span>
            <span className="text-sm font-normal text-muted">
              Refrigeración y Ferretería
            </span>
          </Link>
        </div>
        <CategoryNav />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
