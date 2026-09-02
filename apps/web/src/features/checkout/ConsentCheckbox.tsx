'use client';

import Link from 'next/link';
import { CONSENT_COPY } from '@/features/legal/routes';

export interface ConsentCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  inputId: string;
}

/**
 * Checkbox de consentimiento (AC-4, AC-8) — **consume** el seam de US-017, no
 * lo reescribe (`design.md` D9). Cero rutas legales escritas a mano acá: el
 * guard de `routes.test.ts` (US-017) recorre todo `apps/web/src`/`apps/web/app`
 * y falla si el literal de esa ruta aparece fuera de `routes.ts`.
 */
export function ConsentCheckbox({ checked, onChange, error, inputId }: ConsentCheckboxProps) {
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className="mt-1 h-5 w-5 shrink-0 rounded-sm border border-border focus:outline-none focus-visible:shadow-focus"
        />
        <label htmlFor={inputId} className="text-sm text-foreground">
          {CONSENT_COPY.lead}{' '}
          {CONSENT_COPY.links.map((link, i) => (
            <span key={link.href}>
              <Link href={link.href} className="underline">
                {link.label}
              </Link>
              {i < CONSENT_COPY.links.length - 1 ? ' y ' : '.'}
            </span>
          ))}{' '}
          <span className="text-muted">{CONSENT_COPY.trailing}</span>
        </label>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
