'use client';

import Image from 'next/image';
import { formatArs } from '@/lib/format/currency';
import type { CartItem } from '@/api/generated/model';
import { QuantityStepper } from './QuantityStepper';
import type { LineConflict } from './useCart';

export interface CartItemRowProps {
  item: CartItem;
  mutating?: boolean;
  conflict?: LineConflict;
  onSetQuantity: (slug: string, quantity: number) => void;
  onRemove: (slug: string) => void;
}

/**
 * Copy de los estados de disponibilidad. Va en **texto**, nunca sólo en color
 * (`design-system` §7.7 — el color no puede ser el único portador de significado,
 * WCAG 2.1 AA).
 */
function motivoDe(item: CartItem): string | null {
  if (item.availability === 'insufficient_stock') {
    const quedan = item.available_quantity ?? 0;
    return quedan > 0
      ? `Quedan ${quedan} unidades y pediste ${item.quantity}. No entra en el total hasta que lo ajustes.`
      : 'Se quedó sin stock. No entra en el total.';
  }
  if (item.availability === 'unavailable') {
    return 'Ya no está disponible. No entra en el total.';
  }
  return null;
}

/**
 * Línea del carrito.
 *
 * Todo importe se muestra **tal como lo devuelve el backend**, que ya recalcula
 * con el precio vigente (AC-9), y se formatea **sólo** con `formatArs` — el mismo
 * helper en server y client, así no hay hydration mismatch (`design-system` §7.4).
 *
 * Una línea bloqueada se **marca**, no se toca: ofrece «ajustar a N» y «quitar»
 * como acciones explícitas y nunca muta el carrito por su cuenta (OQ-FE-3). El
 * backend tampoco la borra.
 */
export function CartItemRow({
  item,
  mutating = false,
  conflict,
  onSetQuantity,
  onRemove,
}: CartItemRowProps) {
  const motivo = motivoDe(item);
  const bloqueada = item.availability !== 'available';
  const ajustarA = item.available_quantity ?? conflict?.availableQuantity;

  return (
    <li
      className="flex gap-4 border-b border-border py-4"
      data-availability={item.availability}
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-gray-100">
        {item.image_url && (
          <Image src={item.image_url} alt={item.name} fill sizes="80px" className="object-cover" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="shrink-0 text-sm font-semibold">
            {formatArs(item.subtotal_ars_cents)}
          </p>
        </div>

        <p className="text-xs text-muted">
          {formatArs(item.unit_price_ars_cents)} por unidad
          {item.price_changed && item.previous_unit_price_ars_cents !== undefined && (
            // El cambio de precio se hace VISIBLE, no se aplica en silencio (AC-9).
            <span className="ml-1 text-foreground">
              — cambió de {formatArs(item.previous_unit_price_ars_cents)} a{' '}
              {formatArs(item.unit_price_ars_cents)}
            </span>
          )}
        </p>

        {bloqueada && (
          <span className="inline-flex w-fit items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
            {item.availability === 'insufficient_stock'
              ? `Quedan ${item.available_quantity ?? 0}`
              : 'Ya no disponible'}
          </span>
        )}

        {motivo && <p className="text-xs text-gray-600">{motivo}</p>}

        {conflict && (
          <p className="text-xs text-gray-600" role="status">
            {conflict.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {item.availability !== 'unavailable' && (
            <QuantityStepper
              productName={item.name}
              quantity={item.quantity}
              maxQuantity={item.max_quantity}
              mutating={mutating}
              onChange={(quantity) => onSetQuantity(item.slug, quantity)}
            />
          )}

          {bloqueada && ajustarA !== undefined && ajustarA > 0 && (
            <button
              type="button"
              disabled={mutating}
              onClick={() => onSetQuantity(item.slug, ajustarA)}
              className="min-h-[44px] text-sm font-medium text-primary underline disabled:opacity-60"
            >
              Ajustar a {ajustarA}
            </button>
          )}

          <button
            type="button"
            disabled={mutating}
            onClick={() => onRemove(item.slug)}
            aria-label={`Quitar ${item.name} del carrito`}
            className="min-h-[44px] text-sm text-muted underline disabled:opacity-60"
          >
            Quitar
          </button>
        </div>
      </div>
    </li>
  );
}
