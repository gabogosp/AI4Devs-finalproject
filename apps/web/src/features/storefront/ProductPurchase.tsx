'use client';

import { Button } from '@/components/ui/Button';
import { WhatsAppLink } from '@/features/contact/WhatsAppLink';
import { WHATSAPP_MESSAGES } from '@/features/contact/whatsapp';

/** Copy del design-system §10.2 — momento de ansiedad "sin stock". */
const OUT_OF_STOCK_COPY =
  'Sin stock por ahora. Escribinos por WhatsApp y te avisamos cuando vuelva.';

/**
 * Estados de compra de la ficha.
 *
 * **Con stock** (AC-3): mientras el carrito (US-007) no exista, el MVP no puede
 * dejar un producto sin forma de comprarlo. La CTA primaria es **"Comprar por
 * WhatsApp"** (canal humano, funcional hoy) y debajo queda el botón "Agregar al
 * carrito" `disabled` como señal explícita del roadmap — no como único control,
 * que sería un botón muerto que erosiona la confianza (§7.14).
 *
 * **Sin stock** (AC-4): el botón de compra **se reemplaza** por el canal humano
 * — no queda un disabled mudo (design-system §7.3). El badge lleva **texto**,
 * no sólo color, porque el color nunca puede ser el único portador de
 * significado (§7.7, WCAG 2.1 AA).
 */
export function ProductPurchase({
  inStock,
  productName,
  onAddToCart,
}: {
  inStock: boolean;
  productName: string;
  onAddToCart?: () => void;
}) {
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
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="inline-flex w-fit items-center rounded-full bg-success-subtle px-3 py-1 text-sm font-medium text-foreground">
        En stock
      </span>
      {/* Camino de compra del MVP (sin carrito todavía): canal humano por WhatsApp. */}
      <WhatsAppLink
        label="Comprar por WhatsApp"
        message={WHATSAPP_MESSAGES.product(productName)}
      />
      <Button
        variant="accent"
        className="w-fit"
        disabled
        onClick={onAddToCart}
      >
        Agregar al carrito
      </Button>
      <p className="text-xs text-muted">
        Carrito próximamente — por ahora coordinás la compra por WhatsApp.
      </p>
    </div>
  );
}
