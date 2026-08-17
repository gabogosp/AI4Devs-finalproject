'use client';

import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { publicEnv } from '@/lib/env';

/** Copy del design-system §10.2 — momento de ansiedad "sin stock". */
const OUT_OF_STOCK_COPY =
  'Sin stock por ahora. Escribinos por WhatsApp y te avisamos cuando vuelva.';

/**
 * Estados de compra de la ficha.
 *
 * **Con stock** (AC-3): CTA `accent` "Agregar al carrito" como **disparador**.
 * Va `disabled` con el seam `onAddToCart` listo: la lógica del carrito es de
 * US-007, y un botón activo que no hace nada erosiona la confianza de una
 * tienda que todavía no tiene reputación (§7.14).
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
    const message = `Hola! Quería consultar por "${productName}".`;
    const href = `https://wa.me/${publicEnv.NEXT_PUBLIC_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;

    return (
      <div className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-500">
          Sin stock
        </span>
        <p className="text-sm text-muted">{OUT_OF_STOCK_COPY}</p>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] w-fit items-center justify-center gap-2 rounded-md bg-accent-strong px-4 text-sm font-medium text-white focus:outline-none focus-visible:shadow-focus"
        >
          {/* Ícono + texto, nunca sólo ícono (§7.14). */}
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Avisame por WhatsApp
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="inline-flex w-fit items-center rounded-full bg-success-subtle px-3 py-1 text-sm font-medium text-foreground">
        En stock
      </span>
      <Button
        variant="accent"
        className="w-fit"
        disabled
        onClick={onAddToCart}
      >
        Agregar al carrito
      </Button>
    </div>
  );
}
