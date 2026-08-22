import type { ReactNode } from 'react';
import Link from 'next/link';
import { CategoryNav } from '@/features/storefront/CategoryNav';
import { SiteFooter } from '@/features/contact/SiteFooter';
import { WhatsAppLink } from '@/features/contact/WhatsAppLink';
import { WHATSAPP_MESSAGES } from '@/features/contact/whatsapp';

/**
 * Layout del storefront público (ADR-0010: la raíz es pública).
 *
 * Wordmark + `CategoryNav` (US-002 AC-1: los rubros son navegables e
 * indexables desde cualquier página pública, incluida la ficha). El resto del
 * top-nav —buscador, carrito, cuenta— es `Deferred: US-004/US-007`.
 *
 * El `SiteFooter` (US-018 AC-1) se monta acá para que el canal de contacto esté
 * en toda página pública sin que ninguna página lo repita.
 *
 * ⚠ Sin `loading.tsx` en ningún nivel de `(storefront)`: la boundary de Suspense
 * transmite el shell con el status 200 ya comprometido y vuelve imposible un 404
 * real (US-003 `design.md` D1.bis; gap F59).
 */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
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
          {/* Variante discreta y nombre accesible distinto al del footer: un
              lector de pantalla que liste los enlaces no muestra dos entradas
              idénticas. */}
          <WhatsAppLink
            variant="ghost"
            label="WhatsApp"
            message={WHATSAPP_MESSAGES.general}
          />
        </div>
        <CategoryNav />
      </header>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
