import { OrdersList } from '@/features/orders/OrdersList';

export default function Page() {
  return (
    <section className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Órdenes</h1>
      <OrdersList />
    </section>
  );
}
