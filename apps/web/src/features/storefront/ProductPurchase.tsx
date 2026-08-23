'use client';

import { track } from '@/lib/observability/events';
import { AddToCartButton } from '@/features/cart/AddToCartButton';
import { WhatsAppLink } from '@/features/contact/WhatsAppLink';
import { WHATSAPP_MESSAGES } from '@/features/contact/whatsapp';

/** Copy del design-system §10.2 — momento de ansiedad "sin stock". */
const OUT_OF_STOCK_COPY =
  'Sin stock por ahora. Escribinos por WhatsApp y te avisamos cuando vuelva.';

/**
 * Estados de compra de la ficha.
 *
 * **Con stock** (AC-3): la CTA primaria es **"Agregar al carrito"** (US-007), y
 * el canal humano por WhatsApp **se conserva** debajo — no como respaldo del
 * carrito, sino porque para una ferretería sigue siendo un camino legítimo:
 * consultar medidas, compatibilidades o coordinar un retiro. Hasta US-007 el botón
 * estaba `disabled` como señal de roadmap; este change apaga ese cartel.
 *
 * **Sin stock** (AC-4): el botón de compra **se reemplaza** por el canal humano
 * — no queda un disabled mudo (design-system §7.3). El badge lleva **texto**,
 * no sólo color, porque el color nunca puede ser el único portador de
 * significado (§7.7, WCAG 2.1 AA).
 */
export function ProductPurchase({
  inStock,
  productName,
  productSlug,
}: {
  inStock: boolean;
  productName: string;
  productSlug: string;
}) {
  /**
   * Salida al canal humano. `context` distingue las dos superficies: sin stock
   * mide demanda perdida; con stock mide el camino de compra real del MVP
   * mientras el carrito no exista. Sin PII: nunca viaja el mensaje, el número
   * ni nada del visitante.
   */
  const registrarClick = (context: 'pdp_out_of_stock' | 'pdp_in_stock') => () =>
    track('whatsapp_click', { context, product_slug: productSlug });
  if (!inStock) {
    return (
      <div className="flex flex-col gap-3">
        {/* `text-gray-600`, no `-500`: sobre `bg-gray-100` el 500 da 4.39:1 y
            WCAG 2.1 AA exige 4.5:1 para texto normal. Quedaba a un pelo, así que
            no se veía a ojo — lo detectó axe en browser real (TC-320c). El
            contraste no es medible en jsdom, por eso el test de componente
            pasaba. */}
        <span className="inline-flex w-fit items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
          Sin stock
        </span>
        <p className="text-sm text-muted">{OUT_OF_STOCK_COPY}</p>
        <WhatsAppLink
          label="Avisame por WhatsApp"
          message={WHATSAPP_MESSAGES.product(productName)}
          onClick={registrarClick('pdp_out_of_stock')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="inline-flex w-fit items-center rounded-full bg-success-subtle px-3 py-1 text-sm font-medium text-foreground">
        En stock
      </span>
      <AddToCartButton slug={productSlug} productName={productName} className="w-fit" />
      {/* El canal humano se conserva: consultar medidas o compatibilidades sigue
          siendo un camino legítimo, no un respaldo del carrito. */}
      <WhatsAppLink
        label="Consultar por WhatsApp"
        message={WHATSAPP_MESSAGES.product(productName)}
        onClick={registrarClick('pdp_in_stock')}
      />
    </div>
  );
}
