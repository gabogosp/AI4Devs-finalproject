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
          {/* Sólo lo que hoy es cierto. Un enlace legal apuntando a `#` en
              producción es PEOR que no tenerlo (Ley 25.326).
              Deferred: US-017 — política de privacidad y términos.
              Deferred: OQ-FE-14 — horarios reales, dato del dueño. */}
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
