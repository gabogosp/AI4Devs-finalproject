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
}

/**
 * «Agregar al carrito» — usado por la ficha (US-003) y por la card del listado
 * (US-002, OQ-FE-2).
 *
 * Agrega **una unidad** y confirma con el mini-cart, **sin redirigir** (AC-1 +
 * `design-system` §7.11). El badge del top-nav se actualiza solo porque comparte
 * el estado por `CartProvider`, sin recargar la página.
 *
 * Un 409 o un 404 no se manejan acá: quedan en el estado del carrito y se ven en
 * `/carrito`, que es donde la persona puede hacer algo al respecto. Acá sólo se
 * evita el doble envío mientras la operación vuela.
 */
export function AddToCartButton({
  slug,
  productName,
  variant = 'accent',
  label = 'Agregar al carrito',
  className,
  autoCloseMs,
}: AddToCartButtonProps) {
  const { add, state } = useCartContext();
  const [confirmado, setConfirmado] = useState(false);

  const enVuelo = state.kind === 'ready' && state.mutatingSlugs.includes(slug);

  async function agregar() {
    await add(slug);
    setConfirmado(true);
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
      <MiniCart
        productName={productName}
        open={confirmado}
        onClose={() => setConfirmado(false)}
        {...(autoCloseMs !== undefined ? { autoCloseMs } : {})}
      />
    </>
  );
}
