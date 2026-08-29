import Link from 'next/link';
import { captureError } from '@/lib/observability/sentry';
import { categoriesStorefrontService } from './categoriesStorefrontService';

/**
 * Barra de rubros del storefront (design-system §7.10 — "load-bearing para SEO:
 * links indexables").
 *
 * Server Component a propósito (next-standards §2): no tiene estado ni
 * handlers, así que no agrega **un byte** de JS de cliente y sus links están
 * siempre en el DOM servido, que es lo que la hace indexable (AC-1).
 *
 * El dropdown de subrubros del §7.10 completo es `Deferred: US-004/US-007`.
 */
export async function CategoryNav() {
  // Degradación explícita: si el árbol cae se pierde la NAV, no el SITIO.
  // Sin este catch un 5xx del endpoint del árbol tumbaría toda página del
  // storefront —incluida la ficha, que no lo necesita— (resilience #10).
  const rubros = await categoriesStorefrontService.getTree().catch((e: unknown) => {
    captureError(e);
    return [];
  });

  if (rubros.length === 0) return null;

  return (
    <nav aria-label="Rubros" className="overflow-x-auto border-b border-border">
      <ul className="mx-auto flex max-w-5xl gap-4 px-4">
        {rubros.map((rubro) => (
          <li key={rubro.slug}>
            <Link
              href={`/categorias/${rubro.slug}`}
              className="flex min-h-[44px] items-center whitespace-nowrap text-sm focus:outline-none focus-visible:shadow-focus"
            >
              {rubro.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
