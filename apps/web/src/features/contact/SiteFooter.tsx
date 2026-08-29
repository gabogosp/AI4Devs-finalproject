import Link from 'next/link';
import { LEGAL_ROUTES } from '@/features/legal/routes';
import { WhatsAppLink } from './WhatsAppLink';
import { WHATSAPP_MESSAGES } from './whatsapp';

/**
 * Pie del storefront público (AC-1). Es el primer footer del sitio.
 *
 * Server Component montado en el layout del route group: así aparece en **toda**
 * página pública sin que ninguna página tenga que hacer nada, y sin enviar
 * JavaScript de cliente a un sitio cuyo objetivo es ser indexado.
 *
 * Se usa `<footer>` nativo, que aporta el landmark `contentinfo` sin `role`
 * explícito.
 */
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 text-sm text-muted md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-medium text-foreground">
            DSM Refrigeración y Ferretería
          </p>
          <p>Av. Córdoba y Av. Pueyrredón, CABA</p>
          {/* US-017 T3.1 (AC-3) — los enlaces legales, ahora que las páginas
              existen. Los `href` salen de `LEGAL_ROUTES` y nunca de un literal:
              hay un guard en `routes.test.ts` que falla si el literal aparece
              fuera de ese módulo.

              El `<nav>` con `aria-label` propio evita que un lector de pantalla
              liste estos dos enlaces mezclados con los del resto del footer, y
              `min-h-[44px]` es el área táctil del design-system §11 — importa
              acá porque son dos enlaces chicos y juntos.

              Deferred: OQ-FE-14 — horarios reales, dato del dueño. */}
          <nav aria-label="Legales" className="mt-2">
            <ul className="flex flex-wrap gap-4">
              <li>
                <Link
                  href={LEGAL_ROUTES.privacidad}
                  className="flex min-h-[44px] items-center underline focus:outline-none focus-visible:shadow-focus"
                >
                  Política de privacidad
                </Link>
              </li>
              <li>
                <Link
                  href={LEGAL_ROUTES.terminos}
                  className="flex min-h-[44px] items-center underline focus:outline-none focus-visible:shadow-focus"
                >
                  Términos y condiciones
                </Link>
              </li>
            </ul>
          </nav>
        </div>
        <WhatsAppLink
          variant="accent"
          label="Hablá con nosotros"
          message={WHATSAPP_MESSAGES.general}
        />
      </div>
    </footer>
  );
}
