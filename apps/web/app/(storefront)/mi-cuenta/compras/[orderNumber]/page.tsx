import type { Metadata } from 'next';
import { CustomerGuard } from '@/features/account/CustomerGuard';
import { PurchaseDetail } from '@/features/order-history/PurchaseDetail';

/**
 * Detalle de una compra propia (US-015 AC-2). `noindex`: es contenido
 * personal. El identificador de ruta es el `order_number` público (entero,
 * ≥1000) — nunca el UUID interno, igual que expone el contrato
 * (`GET /v1/me/orders/{order_number}`).
 */
export const metadata: Metadata = {
  title: 'Detalle de mi compra — DSM',
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <CustomerGuard>
        <PurchaseDetail orderNumber={orderNumber} />
      </CustomerGuard>
    </div>
  );
}
