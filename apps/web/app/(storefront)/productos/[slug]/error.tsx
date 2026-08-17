'use client';

import { useEffect } from 'react';
import { captureError } from '@/lib/observability/sentry';
import { Button } from '@/components/ui/Button';

/**
 * Error boundary de la ficha: **reporta** a observabilidad (nunca silencia) y
 * ofrece reintento — `frontend-resilience-patterns` #10. Un 404 no llega acá:
 * lo intercepta `notFound()` y lo sirve `not-found.tsx`.
 */
export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-xl flex-col gap-3 p-8">
      <h2 className="text-lg font-bold text-foreground">
        No pudimos mostrar el producto
      </h2>
      <p className="text-muted">
        Puede ser un problema momentáneo. Probá de nuevo en unos segundos.
      </p>
      <Button onClick={reset} className="self-start">
        Reintentar
      </Button>
    </div>
  );
}
