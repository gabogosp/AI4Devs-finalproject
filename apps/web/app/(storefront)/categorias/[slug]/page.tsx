import { notFound } from 'next/navigation';
import { categoriesStorefrontService } from '@/features/storefront/categoriesStorefrontService';
import { ProductCard } from '@/features/storefront/ProductCard';
import { Pagination, normalizePage } from '@/features/storefront/Pagination';
import { isAppError } from '@/lib/http/errors';

/**
 * Página pública de una categoría (US-002). Server Component: los subrubros y
 * los productos salen en el HTML del servidor, que es lo que un buscador
 * indexa (AC-10).
 *
 * **No existe `loading.tsx` en este segmento ni en todo `(storefront)`**, y es
 * deliberado (design.md D10 / gap F59): un `loading.tsx` envuelve el segmento
 * en Suspense, Next transmite el shell con **status 200 ya comprometido**, y el
 * `notFound()` posterior llega como fallback de streaming dentro de ese 200 —
 * el soft-200 indexable que AC-9 prohíbe. Puesto en el route group rompería
 * además el 404 de la ficha de US-003, que ya está en producción.
 */
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const current = normalizePage((await searchParams)?.page);

  const category = await categoriesStorefrontService.getBySlug(slug).catch(
    (error: unknown) => {
      // Slug inexistente → 404 REAL (AC-9), nunca un 200 vacío.
      if (isAppError(error, 'notFound')) notFound();
      throw error; // el resto sube al error boundary del segmento
    },
  );

  const { data, pagination } = await categoriesStorefrontService.listProducts(slug, current);

  // Página fuera de rango → 404 REAL (OQ-FE-9): una página 4 que no existe es
  // exactamente la "página fantasma indexable" que AC-9 prohíbe. En cambio,
  // vacío en la página 1 es 200 + estado vacío (AC-6): la categoría existe.
  if (current > 1 && data.length === 0) notFound();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-bold text-foreground lg:text-3xl">
        {category.name}
      </h1>

      {data.length > 0 && (
        <>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
            {data.map((item) => (
              <ProductCard key={item.slug} item={item} categoryName={category.name} />
            ))}
          </section>

          <Pagination
            slug={slug}
            current={current}
            total={pagination.total}
            pageSize={pagination.limit}
          />
        </>
      )}
    </div>
  );
}
