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
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center p-4">
          <Link
            href="/"
            className="text-lg font-bold text-primary focus:outline-none focus-visible:shadow-focus"
          >
            DSM
            <span className="ml-2 text-sm font-normal text-muted">
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
