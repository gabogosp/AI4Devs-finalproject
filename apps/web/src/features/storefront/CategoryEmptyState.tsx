import Link from 'next/link';
import { PackageOpen } from 'lucide-react';

/**
 * Estado vacío de una categoría (AC-6).
 *
 * Nunca un vacío mudo: ícono + mensaje + **camino de salida** real
 * (design-system §10.1). Los subrubros los lista la propia página encima de
 * este bloque —siempre que existan, no sólo cuando está vacía—, así que acá
 * sólo va la salida general para no duplicar los mismos links.
 */
export function CategoryEmptyState() {
  return (
    <section className="flex flex-col items-start gap-4 rounded-lg bg-gray-50 p-8">
      <PackageOpen className="h-12 w-12 text-gray-400" aria-hidden="true" />
      <p className="text-muted">
        Todavía no hay productos publicados en esta categoría.
      </p>


      <Link
        href="/"
        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus:outline-none focus-visible:shadow-focus"
      >
        Ver todos los rubros
      </Link>
    </section>
  );
}
