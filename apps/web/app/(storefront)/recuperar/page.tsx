import type { Metadata } from 'next';
import { ResetRequestForm } from '@/features/account/ResetRequestForm';

export const metadata: Metadata = {
  title: 'Recuperar contraseña — DSM',
  robots: { index: false, follow: false },
};

export default function RecuperarPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Recuperar contraseña</h1>
      <p className="text-sm text-muted">
        Escribí tu email y te mandamos un link para elegir una contraseña nueva.
      </p>
      <ResetRequestForm />
    </div>
  );
}
