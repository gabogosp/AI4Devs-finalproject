import Link from 'next/link';
import { PackageOpen } from 'lucide-react';
import type { CategoryRef } from '@/api/generated/model';

/**
 * Estado vacío de una categoría (AC-6).
 *
 * Nunca un vacío mudo: ícono + mensaje + **camino de salida** real
 * (design-system §10.1). Un rubro con subrubros pero sin productos propios
 * ofrece sus subrubros —AC-1 dice "subrubros **y/o** productos"—; siempre
 * queda además el link a todos los rubros.
 */
export function CategoryEmptyState({ subcategories }: { subcategories: CategoryRef[] }) {
  return (
    <section className="flex flex-col items-start gap-4 rounded-lg bg-gray-50 p-8">
      <PackageOpen className="h-12 w-12 text-gray-400" aria-hidden="true" />
      <p className="text-muted">
        Todavía no hay productos publicados en esta categoría.
      </p>

      {subcategories.length > 0 && (
        <ul className="flex flex-wrap gap-3 text-sm">
          {subcategories.map((sub) => (
            <li key={sub.slug}>
              <Link
                href={`/categorias/${sub.slug}`}
                className="focus:outline-none focus-visible:shadow-focus"
              >
                {sub.name}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/"
        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus:outline-none focus-visible:shadow-focus"
      >
        Ver todos los rubros
      </Link>
    </section>
  );
}
