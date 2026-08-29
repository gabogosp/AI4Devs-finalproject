import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ResetConfirmForm } from '@/features/account/ResetConfirmForm';

/**
 * Confirmación de recuperación (US-014 AC-4/AC-7).
 *
 * La ruta la fija el backend: el mailer arma
 * `${PASSWORD_RESET_URL_BASE}/recuperar/confirmar?token=…`. Cambiarle el nombre
 * rompe AC-4 en producción sin romper un solo test.
 *
 * `noindex` es obligatorio acá: la URL lleva un token de un solo uso en la
 * query, y no queremos que termine en el índice de un buscador.
 */
export const metadata: Metadata = {
  title: 'Elegí tu contraseña — DSM',
  robots: { index: false, follow: false },
};

export default function ConfirmarRecuperacionPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Elegí tu contraseña nueva</h1>
      <Suspense fallback={null}>
        <ResetConfirmForm />
      </Suspense>
    </div>
  );
}
