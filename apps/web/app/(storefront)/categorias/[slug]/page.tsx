import { notFound } from 'next/navigation';
import { categoriesStorefrontService } from '@/features/storefront/categoriesStorefrontService';
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
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ page?: string }>;
}) {
  const { slug } = await params;

  const category = await categoriesStorefrontService.getBySlug(slug).catch(
    (error: unknown) => {
      // Slug inexistente → 404 REAL (AC-9), nunca un 200 vacío.
      if (isAppError(error, 'notFound')) notFound();
      throw error; // el resto sube al error boundary del segmento
    },
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-bold text-foreground lg:text-3xl">
        {category.name}
      </h1>
    </div>
  );
}
