import Link from 'next/link';
import { OrdersList } from '@/features/orders/OrdersList';
import { PendingPaymentsPanel } from '@/features/orders/PendingPaymentsPanel';

/**
 * Server Component que lee `searchParams` (`design.md` §D9): monta
 * **exactamente uno** de `OrdersList` / `PendingPaymentsPanel`, nunca ambos —
 * `pending_payment` no puede filtrarse jamás a la cola de fulfillment (AC-8).
 */
export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const tab = (await searchParams)?.tab;
  const pendientesDePago = tab === 'pendientes-de-pago';

  return (
    <section className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Órdenes</h1>
      <nav className="flex gap-4 border-b border-border" aria-label="Vistas de órdenes">
        <Link
          href="/admin/ordenes"
          aria-current={pendientesDePago ? undefined : 'page'}
          className="p-2 text-sm font-medium data-[active=true]:border-b-2 data-[active=true]:border-primary"
          data-active={!pendientesDePago}
        >
          Fulfillment
        </Link>
        <Link
          href="/admin/ordenes?tab=pendientes-de-pago"
          aria-current={pendientesDePago ? 'page' : undefined}
          className="p-2 text-sm font-medium data-[active=true]:border-b-2 data-[active=true]:border-primary"
          data-active={pendientesDePago}
        >
          Pendientes de pago
        </Link>
      </nav>
      {pendientesDePago ? (
        <div data-testid="pending-payments-panel">
          <PendingPaymentsPanel />
        </div>
      ) : (
        <div data-testid="orders-list">
          <OrdersList />
        </div>
      )}
    </section>
  );
}
