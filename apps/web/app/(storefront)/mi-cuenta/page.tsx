import type { Metadata } from 'next';
import { MiCuentaScreen } from '@/features/account/MiCuentaScreen';

/**
 * Destino de la sesión (US-014 AC-2). `noindex`: es contenido personal.
 *
 * Nada se renderiza en servidor: `MiCuentaScreen` es cliente, así que la
 * Data Cache de Next nunca ve datos de una persona (G-1). Desde US-020, es
 * `MiCuentaScreen` —no el guard directamente— quien decide qué mostrar: el
 * flag "recién borrada" vive por ENCIMA de `CustomerGuard` (design.md §D3).
 */
export const metadata: Metadata = {
  title: 'Mi cuenta — DSM',
  robots: { index: false, follow: false },
};

export default function MiCuentaPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Mi cuenta</h1>
      <MiCuentaScreen />
    </div>
  );
}
