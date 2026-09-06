import Link from 'next/link';
import { captureError } from '@/lib/observability/sentry';
import { categoriesStorefrontService } from './categoriesStorefrontService';

/**
 * Barra de rubros del storefront (design-system §7.10 — "load-bearing para SEO:
 * links indexables").
 *
 * Server Component a propósito (next-standards §2): no tiene estado ni
 * handlers, así que no agrega **un byte** de JS de cliente y sus links están
 * siempre en el DOM servido, que es lo que la hace indexable (AC-1) — incluidos
 * los que quedan detrás de `<details>` abajo: el contenido colapsado sigue en
 * el DOM, sólo se oculta visualmente, así que Google lo sigue indexando.
 *
 * El dropdown de subrubros del §7.10 completo es `Deferred: US-004/US-007`.
 *
 * `TOPE_VISIBLE` (WCAG 2.4.1, encontrado real corrigiendo TC-731): sin tope,
 * esta lista crece con el catálogo y CADA rubro es un `Tab` más en TODA
 * página pública, antes de llegar a buscador/carrito/contenido. Reproducido:
 * con 78 rubros acumulados (residuo de corridas de test QA repetidas contra
 * la misma DB), esta nav por sí sola agotaba cualquier presupuesto razonable
 * de `Tab`. El resto queda detrás de un único `<details>` — mismo patrón que
 * `SalesChart.tsx` ("Ver datos en tabla") — que aporta UN SOLO focusable
 * adicional en vez de uno por rubro extra, sin sacar ningún link del DOM.
 */
const TOPE_VISIBLE = 8;

function ItemRubro({ rubro }: { rubro: { slug: string; name: string } }) {
  return (
    <li>
      <Link
        href={`/categorias/${rubro.slug}`}
        className="flex min-h-[44px] items-center whitespace-nowrap text-sm focus:outline-none focus-visible:shadow-focus"
      >
        {rubro.name}
      </Link>
    </li>
  );
}

export async function CategoryNav() {
  // Degradación explícita: si el árbol cae se pierde la NAV, no el SITIO.
  // Sin este catch un 5xx del endpoint del árbol tumbaría toda página del
  // storefront —incluida la ficha, que no lo necesita— (resilience #10).
  const rubros = await categoriesStorefrontService.getTree().catch((e: unknown) => {
    captureError(e);
    return [];
  });

  if (rubros.length === 0) return null;

  const visibles = rubros.slice(0, TOPE_VISIBLE);
  const resto = rubros.slice(TOPE_VISIBLE);

  return (
    <nav aria-label="Rubros" className="border-b border-border">
      <div className="mx-auto max-w-5xl px-4">
        <ul className="flex gap-4 overflow-x-auto">
          {visibles.map((rubro) => (
            <ItemRubro key={rubro.slug} rubro={rubro} />
          ))}
        </ul>
        {resto.length > 0 && (
          <details className="pb-2">
            <summary
              className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-sm text-muted focus:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden"
            >
              Más rubros ({resto.length})
            </summary>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 pb-2">
              {resto.map((rubro) => (
                <ItemRubro key={rubro.slug} rubro={rubro} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </nav>
  );
}
