import type { Metadata } from 'next';
import { CustomerGuard } from '@/features/account/CustomerGuard';
import { PurchaseHistoryList } from '@/features/order-history/PurchaseHistoryList';

/**
 * Listado del historial de compras (US-015 AC-1). `noindex`: es contenido
 * personal. Nada se renderiza en servidor: el guard y el listado son cliente
 * (G-1, `customFetch` con `session: 'customer'` lanza si sale del servidor).
 */
export const metadata: Metadata = {
  title: 'Mis compras — DSM',
  robots: { index: false, follow: false },
};

export default function ComprasPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Mis compras</h1>
      <CustomerGuard>
        <PurchaseHistoryList />
      </CustomerGuard>
    </div>
  );
}
