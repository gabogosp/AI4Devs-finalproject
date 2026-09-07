'use client';

import { useRef, useState, type KeyboardEvent } from 'react';

export interface StarRatingInputProps {
  value: number;
  onChange: (rating: number) => void;
  disabled?: boolean;
}

const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * Selector de calificación 1-5 estrellas (US §8, `design.md` §D3).
 *
 * `role="radiogroup"` + cada estrella `role="radio"` — patrón WAI-ARIA
 * radiogroup: una sola parada de Tab (roving tabindex), navegación con
 * flechas dentro del grupo, Enter/Space selecciona el foco actual.
 * Estructuralmente no hay forma de producir un valor fuera de 1-5: sólo
 * existen 5 controles y las flechas envuelven entre 1 y 5 (AC-9).
 *
 * Tokens de color reusados de `ProductPurchase.tsx` (`text-warning`/
 * `text-muted`) — el design-system no declara un token de "amarillo
 * estrella" dedicado (`design.md` §D3).
 */
export function StarRatingInput({ value, onChange, disabled = false }: StarRatingInputProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number>(value || 1);
  const buttonRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  function select(rating: number) {
    if (disabled) return;
    setFocused(rating);
    onChange(rating);
  }

  function moveFocus(rating: number) {
    setFocused(rating);
    buttonRefs.current[rating]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, rating: number) {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(rating < 5 ? rating + 1 : 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(rating > 1 ? rating - 1 : 5);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        select(rating);
        break;
      default:
        break;
    }
  }

  const highlightUpTo = hovered ?? value;

  return (
    <div role="radiogroup" aria-label="Calificación" className="flex gap-1">
      {RATINGS.map((n) => (
        <button
          key={n}
          ref={(el) => {
            buttonRefs.current[n] = el;
          }}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={`${n} de 5 estrellas`}
          tabIndex={n === focused ? 0 : -1}
          disabled={disabled}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setFocused(n)}
          onClick={() => select(n)}
          onKeyDown={(event) => handleKeyDown(event, n)}
          className={`text-2xl leading-none focus:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60 ${
            n <= highlightUpTo ? 'text-warning' : 'text-muted'
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
