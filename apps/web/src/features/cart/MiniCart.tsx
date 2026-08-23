'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** Cierre automático del mini-cart (`design-system` §7.6 — toast de 4 s). */
export const AUTO_CLOSE_MS = 4000;

export interface MiniCartProps {
  productName: string;
  open: boolean;
  onClose: () => void;
  /** Inyectable sólo para los tests (los fake timers cuelgan a `userEvent`). */
  autoCloseMs?: number;
}

/**
 * Confirmación de «agregado» que baja desde arriba (`design-system` §7.11).
 *
 * Tres decisiones que no son de estilo:
 *
 * - **No redirige.** El §7.11 es explícito: no interrumpe la navegación. Quien
 *   está mirando el catálogo sigue donde estaba; ir al carrito es una opción, no
 *   una consecuencia.
 * - **`role="status"`, no `alert`.** Agregar algo al carrito no es un error ni una
 *   urgencia; `alert` interrumpe al lector de pantalla y acá no corresponde.
 * - **No roba el foco.** Quien navega con teclado se quedaría sin su lugar. El
 *   contenido se anuncia por la región viva y el enlace se alcanza con `Tab`.
 */
export function MiniCart({
  productName,
  open,
  onClose,
  autoCloseMs = AUTO_CLOSE_MS,
}: MiniCartProps) {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(timer);
  }, [open, onClose, autoCloseMs]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-4 rounded-md border border-border bg-surface px-4 py-3 shadow-lg"
    >
      <p className="text-sm">
        <span aria-hidden="true">✓ </span>
        Agregaste {productName}
      </p>
      <Link
        href="/carrito"
        className="text-sm font-medium text-primary underline focus:outline-none focus-visible:shadow-focus"
      >
        Ir al carrito
      </Link>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar el aviso"
        className="text-sm text-muted"
      >
        ✕
      </button>
    </div>
  );
}
