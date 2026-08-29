'use client';

import type { AsyncState } from '@/lib/async';
import { Button } from '@/components/ui/Button';
import type { Category } from './categoriesService';

/**
 * Presentacional: renderiza el listado según el estado async explícito
 * (skeleton en loading, empty accionable, error con reintento). AC-1.
 */
export function CategoriesList({
  state,
  onRetry,
}: {
  state: AsyncState<Category[]>;
  onRetry: () => void;
}) {
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        Cargando categorías…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>No se pudieron cargar las categorías.</p>
        <Button variant="secondary" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (state.data.length === 0) {
    return <p>Todavía no hay categorías. Creá la primera para empezar.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {state.data.map((c) => (
        <li key={c.id}>{c.name}</li>
      ))}
    </ul>
  );
}
