import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '@/features/account/LoginForm';

export const metadata: Metadata = {
  title: 'Ingresar — DSM',
  robots: { index: false, follow: false },
};

export default function IngresarPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Ingresar</h1>
      {/* `useSearchParams` (el `?next=`) exige una boundary de Suspense en el
          App Router; sin ella el build falla al prerenderizar. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <div className="flex flex-col gap-1 text-sm text-muted">
        <Link href="/recuperar" className="underline">
          Olvidé mi contraseña
        </Link>
        <span>
          ¿No tenés cuenta?{' '}
          <Link href="/crear-cuenta" className="underline">
            Creá una
          </Link>
        </span>
      </div>
    </div>
  );
}
