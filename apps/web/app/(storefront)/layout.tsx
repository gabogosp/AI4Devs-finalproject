import type { ReactNode } from 'react';
import Link from 'next/link';
import { CategoryNav } from '@/features/storefront/CategoryNav';
import { SiteFooter } from '@/features/contact/SiteFooter';
import { WhatsAppLink } from '@/features/contact/WhatsAppLink';
import { WHATSAPP_MESSAGES } from '@/features/contact/whatsapp';
import { AccountMenu } from '@/features/account/AccountMenu';
import { SessionProvider } from '@/features/account/SessionProvider';
import { CartProvider } from '@/features/cart/CartProvider';
import { CartBadge } from '@/features/cart/CartBadge';
import { SearchBar } from '@/features/search/SearchBar';

/**
 * Layout del storefront público (ADR-0010: la raíz es pública).
 *
 * Wordmark + `CategoryNav` (US-002 AC-1: los rubros son navegables e
 * indexables desde cualquier página pública, incluida la ficha). El buscador
 * llegó con US-004 y el carrito con US-007.
 *
 * El `SearchBar` se monta **acá y una sola vez**, que es lo que lo hace
 * aparecer en toda página pública sin que ninguna página lo repita. Es hoja
 * cliente (`useRouter` + estado del input); montarlo no vuelve cliente a este
 * layout.
 *
 * El `SiteFooter` (US-018 AC-1) se monta acá para que el canal de contacto esté
 * en toda página pública sin que ninguna página lo repita.
 *
 * El `SessionProvider` (US-014) y el `CartProvider` (US-007) envuelven el árbol
 * pero **este layout sigue siendo Server Component**: los `children` se pasan como
 * prop, así que se renderizan en servidor igual. El `'use client'` vive en las
 * hojas (`SessionProvider`, `AccountMenu`, `CartProvider`, `CartBadge`), no acá —
 * next-standards §2. Eso es lo que deja a `CategoryNav` renderizando en servidor,
 * de lo que depende el SEO de US-002.
 *
 * ⚠ Sin `loading.tsx` en ningún nivel de `(storefront)`: la boundary de Suspense
 * transmite el shell con el status 200 ya comprometido y vuelve imposible un 404
 * real (US-003 `design.md` D1.bis; gap F59).
 *
 * "Saltar al contenido" (WCAG 2.4.1 Bypass Blocks): sin esto, una persona que
 * navega con teclado repite el mismo bloque (logo, WhatsApp, carrito, cuenta,
 * buscador, `CategoryNav`) en CADA página pública antes de llegar al
 * contenido — encontrado real corrigiendo TC-731 (`carrito.spec.ts`): con el
 * catálogo grande, `CategoryNav` (sin tope — ver su propio comentario) por sí
 * sola agota cualquier presupuesto razonable de `Tab`. El link es el primer
 * nodo del árbol y sólo se ve al enfocarlo (`focus:not-sr-only`); apunta a
 * `#contenido-principal`, que es el `id` + `tabIndex={-1}` del propio `<main>`
 * (`<main>` no es focuseable nativo — sin el `tabIndex` el salto movería el
 * scroll pero no el foco, y el siguiente `Tab` volvería a empezar del header).
 */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <CartProvider>
      <div className="flex min-h-screen flex-col">
      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-focus"
      >
        Saltar al contenido
      </a>
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
          <div className="flex items-center gap-4">
            <WhatsAppLink
              variant="ghost"
              label="WhatsApp"
              message={WHATSAPP_MESSAGES.general}
            />
            <CartBadge />
            <AccountMenu />
          </div>
        </div>
        {/*
          Fila propia y full-width en mobile (OQ-FE-3: sin overlay full-screen).
          En el desktop se acota solo por el `md:max-w-md` del componente.
        */}
        <div className="mx-auto max-w-5xl px-4 pb-3">
          <SearchBar />
        </div>
        <CategoryNav />
      </header>
        <main id="contenido-principal" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <SiteFooter />
      </div>
      </CartProvider>
    </SessionProvider>
  );
}
