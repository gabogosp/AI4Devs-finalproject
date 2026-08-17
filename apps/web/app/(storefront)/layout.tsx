import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Layout del storefront público (ADR-0010: la raíz es pública).
 *
 * Mínimo a propósito: wordmark + enlace a la home. El top-nav real
 * (CategoryNav, SearchBar, carrito) es `Deferred: US-002`.
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
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
