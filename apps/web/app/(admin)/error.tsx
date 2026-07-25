'use client';

import { useEffect } from 'react';
import { captureError } from '@/lib/observability/sentry';
import { Button } from '@/components/ui/Button';

// Error boundary del panel (T8.1): reporta a observabilidad (no silencia) y
// ofrece reintento.
export default function AdminError({
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
    <div role="alert" className="flex flex-col gap-3 p-6">
      <h2 className="text-lg font-bold">Algo salió mal</h2>
      <p className="text-muted">No pudimos completar la operación.</p>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}
