'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { DateRange } from './metricsService';

export interface RangeFilterFormProps {
  appliedRange: DateRange;
  onApply(range: DateRange): void;
}

/**
 * Filtro de rango del panel de métricas (AC-4). Dos `<input type="date">`
 * con estado "borrador" local + botón "Aplicar" — validación client-side de
 * UX (`from <= to`), la autoridad sigue siendo el backend (422,
 * `frontend-standards.md` §12.2). Aplicación explícita en vez de
 * fetch-por-tecla: un `<input type="date">` puede pasar por estados
 * intermedios inválidos mientras el dueño escribe (`design.md` Decisión 4).
 */
export function RangeFilterForm({ appliedRange, onApply }: RangeFilterFormProps) {
  const [draftFrom, setDraftFrom] = useState(appliedRange.from ?? '');
  const [draftTo, setDraftTo] = useState(appliedRange.to ?? '');

  const invalid = Boolean(draftFrom && draftTo && draftFrom > draftTo);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) {
      return;
    }
    onApply({
      from: draftFrom || undefined,
      to: draftTo || undefined,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3"
      aria-label="Filtro de rango del período"
    >
      <label className="flex flex-col gap-1 text-sm">
        Desde
        <input
          type="date"
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
          className="rounded border border-border p-1"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Hasta
        <input
          type="date"
          value={draftTo}
          onChange={(e) => setDraftTo(e.target.value)}
          className="rounded border border-border p-1"
        />
      </label>
      <Button type="submit" disabled={invalid}>
        Aplicar
      </Button>
      {invalid && (
        <p role="alert" className="text-sm text-error">
          La fecha «Desde» no puede ser posterior a «Hasta».
        </p>
      )}
    </form>
  );
}
