import { ProductList } from '@/features/products/ProductList';

export default function Page() {
  return (
    <section className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Productos</h1>
      <ProductList />
    </section>
  );
}
