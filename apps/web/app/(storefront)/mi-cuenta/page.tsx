import type { Metadata } from 'next';
import { AccountPanel } from '@/features/account/AccountPanel';
import { CustomerGuard } from '@/features/account/CustomerGuard';

/**
 * Destino de la sesión (US-014 AC-2). `noindex`: es contenido personal.
 *
 * Nada se renderiza en servidor: el guard y el panel son cliente, así que la
 * Data Cache de Next nunca ve datos de una persona (G-1).
 */
export const metadata: Metadata = {
  title: 'Mi cuenta — DSM',
  robots: { index: false, follow: false },
};

export default function MiCuentaPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Mi cuenta</h1>
      <CustomerGuard>
        <AccountPanel />
      </CustomerGuard>
    </div>
  );
}
