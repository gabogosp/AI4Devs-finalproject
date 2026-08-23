import type { Metadata } from 'next';
import Link from 'next/link';
import { RegisterForm } from '@/features/account/RegisterForm';

/**
 * Alta de cuenta (US-014 AC-1). `noindex`: una pantalla de auth no aporta nada
 * a un buscador y sí superficie de ataque a un scraper.
 */
export const metadata: Metadata = {
  title: 'Crear cuenta — DSM',
  robots: { index: false, follow: false },
};

export default function CrearCuentaPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Crear cuenta</h1>
      <RegisterForm />
      <p className="text-sm text-muted">
        ¿Ya tenés cuenta?{' '}
        <Link href="/ingresar" className="underline">
          Ingresá
        </Link>
      </p>
    </div>
  );
}
