import { notFound } from 'next/navigation';
import { categoriesStorefrontService } from '@/features/storefront/categoriesStorefrontService';
import { ProductCard } from '@/features/storefront/ProductCard';
import { Pagination, normalizePage } from '@/features/storefront/Pagination';
import { CategoryEmptyState } from '@/features/storefront/CategoryEmptyState';
import { CategoryJsonLd } from '@/features/storefront/CategoryJsonLd';
import { CategoryViewTracker } from '@/features/storefront/CategoryViewTracker';
import { categoryMetadata, categoryUrl } from '@/features/storefront/categoryMetadata';
import { Breadcrumb } from '@/features/storefront/Breadcrumb';
import { isAppError } from '@/lib/http/errors';
import type { Metadata } from 'next';

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
/**
 * Metadatos por página de categoría (AC-4). El `fetch` de Next memoiza por URL
 * + opciones, así que esta llamada y la de la page se deduplican.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = normalizePage((await searchParams)?.page);
  const category = await categoriesStorefrontService.getBySlug(slug).catch(() => null);
  return categoryMetadata(category, page);
}

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
      <CategoryJsonLd category={category} />

      <CategoryViewTracker
        slug={slug}
        isRubro={category.parent === null}
        page={current}
        productCount={data.length}
      />

      {/* React 19 hoistea <link> al <head>: es la API disponible para los rel
          que el objeto Metadata no modela (next-standards §10), no un hack. */}
      {current > 1 && (
        <link rel="prev" href={categoryUrl(slug, current - 1)} />
      )}
      {current * pagination.limit < pagination.total && (
        <link rel="next" href={categoryUrl(slug, current + 1)} />
      )}

      <Breadcrumb
        items={[
          { name: 'Inicio', href: '/' },
          ...(category.parent
            ? [
                {
                  name: category.parent.name,
                  href: `/categorias/${category.parent.slug}`,
                },
              ]
            : []),
          { name: category.name },
        ]}
      />

      <h1 className="text-2xl font-bold text-foreground lg:text-3xl">
        {category.name}
      </h1>

      {data.length === 0 && (
        <CategoryEmptyState subcategories={category.children} />
      )}

      {data.length > 0 && (
        <>
          {/* h2 sólo para lectores de pantalla: la card usa h3 para el nombre
              del producto, y sin este nivel intermedio el orden saltaría de h1
              a h3 (violación `heading-order` de axe, detectada en T7.1). */}
          <h2 className="sr-only">Productos</h2>
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
