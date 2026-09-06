'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { track } from '@/lib/observability/events';
import { useCartContext } from './CartProvider';
import { MiniCart } from './MiniCart';

export interface AddToCartButtonProps {
  slug: string;
  productName: string;
  /** `accent` en la ficha (CTA principal), `secondary` en la card del listado. */
  variant?: 'accent' | 'secondary';
  label?: string;
  className?: string;
  /** Inyectable sólo para los tests. */
  autoCloseMs?: number;
  /**
   * Unidades a agregar (default 1). La ficha (C2a) deja elegirla con
   * `QuantityStepper` antes de este botón; la card del listado nunca la pasa.
   */
  quantity?: number;
  /** Se llama sólo si la mutación termina en `'ok'` — la ficha resetea su stepper a 1. */
  onAdded?: () => void;
}

/**
 * «Agregar al carrito» — usado por la ficha (US-003, con cantidad elegible
 * desde C2a) y por la card del listado (US-002, OQ-FE-2, siempre 1 unidad).
 *
 * Confirma con el mini-cart, **sin redirigir** (AC-1 + `design-system` §7.11).
 * El badge del top-nav se actualiza solo porque comparte el estado por
 * `CartProvider`, sin recargar la página.
 *
 * Un 404 no se maneja acá: queda en el estado del carrito y se ve en
 * `/carrito`. Un 409 (stock insuficiente) SÍ se maneja acá — a diferencia de la
 * card del listado (que sólo pide 1, ya acotada por `useCart.add` contra el
 * `max_quantity` real de la línea existente), la ficha deja pedir cualquier
 * cantidad sin conocer el stock real (C2b: el storefront público no lo
 * expone), así que un conflicto real es posible acá por primera vez — mostrar
 * "agregado" en un click que en realidad falló sería el bug.
 */
export function AddToCartButton({
  slug,
  productName,
  variant = 'accent',
  label = 'Agregar al carrito',
  className,
  autoCloseMs,
  quantity = 1,
  onAdded,
}: AddToCartButtonProps) {
  const { add, state } = useCartContext();
  const [confirmado, setConfirmado] = useState(false);

  const enVuelo = state.kind === 'ready' && state.mutatingSlugs.includes(slug);
  const conflicto = state.kind === 'ready' ? state.conflicts[slug] : undefined;

  async function agregar() {
    const resultado = await add(slug, quantity);
    if (resultado !== 'ok') return;
    setConfirmado(true);
    onAdded?.();
    // Sin PII y sin dimensión por producto en la métrica: el slug va en el evento,
    // no en una etiqueta de cardinalidad abierta.
    track('cart_item_added', { product_slug: slug });
  }

  return (
    <>
      <Button
        variant={variant}
        className={className}
        loading={enVuelo}
        onClick={() => void agregar()}
      >
        {label}
      </Button>
      {/* Mismo patrón que `CartItemRow` (`role="status"`, mismo copy del backend). */}
      {conflicto && (
        <p className="text-xs text-gray-600" role="status">
          {conflicto.message}
        </p>
      )}
      <MiniCart
        productName={productName}
        open={confirmado}
        onClose={() => setConfirmado(false)}
        {...(autoCloseMs !== undefined ? { autoCloseMs } : {})}
      />
    </>
  );
}
