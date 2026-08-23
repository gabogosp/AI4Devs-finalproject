'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/** Ventana de agrupación de clics sostenidos (OQ-FE-1: pesimista con debounce). */
export const DEBOUNCE_MS = 400;

export interface QuantityStepperProps {
  /** Nombre del producto — entra en los `aria-label` de los dos botones. */
  productName: string;
  quantity: number;
  /** `min(stock, tope por línea)` que calcula el backend. Techo duro. */
  maxQuantity: number;
  /** La línea tiene una mutación en vuelo: pesimista, se congela (OQ-FE-1). */
  mutating?: boolean;
  /**
   * Ventana de agrupación. Inyectable **sólo** para que los tests no dependan de
   * fake timers: falsear el reloj entero cuelga a `userEvent`, que espera
   * promesas agendadas por `queueMicrotask`. En producción nadie la pasa.
   */
  debounceMs?: number;
  onChange: (quantity: number) => void;
}

/**
 * Stepper de cantidad acotado al stock (`design-system` §7.11 — «no permite
 * superarlo»).
 *
 * **Pesimista** (OQ-FE-1): el número que se ve es el que el servidor confirmó.
 * Mientras vuela una mutación los botones quedan deshabilitados, porque mostrar
 * 5 unidades y que el servidor conteste «quedan 2» obliga a retroceder el número
 * justo cuando la persona descubre que no hay stock.
 *
 * Los clics sostenidos se agrupan con debounce: cinco clics son **una** llamada,
 * no cinco. Sin eso, cada clic gastaría una escritura y el rate-limit del backend
 * se convertiría en un 429 por impaciencia.
 *
 * Quitar **no** es este control: bajar de 1 no lleva a 0 (`0` no es una línea, es
 * un DELETE — el backend lo rechaza a propósito). La acción de quitar vive aparte.
 */
export function QuantityStepper({
  productName,
  quantity,
  maxQuantity,
  mutating = false,
  debounceMs = DEBOUNCE_MS,
  onChange,
}: QuantityStepperProps) {
  // Valor optimista SOLO para el dígito que se ve mientras se agrupan los clics;
  // la verdad sigue siendo el servidor y llega por `quantity`.
  const [pendiente, setPendiente] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPendiente(null);
  }, [quantity]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const visible = pendiente ?? quantity;

  function pedir(siguiente: number) {
    const acotado = Math.min(Math.max(siguiente, 1), maxQuantity);
    if (acotado === visible) return;
    setPendiente(acotado);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(acotado), debounceMs);
  }

  const enElTope = visible >= maxQuantity;
  const enElPiso = visible <= 1;

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => pedir(visible - 1)}
        disabled={mutating || enElPiso}
        aria-label={`Restar una unidad de ${productName}`}
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-md border border-border',
          'text-lg font-medium transition-colors hover:bg-gray-100',
          'focus:outline-none focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        −
      </button>

      <input
        type="number"
        readOnly
        value={visible}
        // `readOnly` en vez de editable: el tope lo define el servidor y un campo
        // libre invita a escribir 999 para que el backend lo rechace. Las flechas
        // siguen funcionando por el handler de teclado.
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            pedir(visible + 1);
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            pedir(visible - 1);
          }
        }}
        disabled={mutating}
        aria-label={`Cantidad de ${productName}`}
        aria-valuemin={1}
        aria-valuemax={maxQuantity}
        aria-valuenow={visible}
        className={cn(
          'h-11 w-14 rounded-md border border-border text-center text-sm font-medium',
          'focus:outline-none focus-visible:shadow-focus',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none',
        )}
      />

      <button
        type="button"
        onClick={() => pedir(visible + 1)}
        disabled={mutating || enElTope}
        aria-label={`Sumar una unidad de ${productName}`}
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-md border border-border',
          'text-lg font-medium transition-colors hover:bg-gray-100',
          'focus:outline-none focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        +
      </button>
    </div>
  );
}
