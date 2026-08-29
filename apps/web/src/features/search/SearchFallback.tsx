import Link from 'next/link';
import type { SearchResponse } from './searchService';
import { SearchFallbackClickTracker } from './SearchTracker';

/**
 * La red de seguridad de AC-3: cuando la búsqueda no convence, se ofrece por
 * dónde seguir.
 *
 * Un «0 resultados» desnudo es un callejón sin salida, y quien lo ve se va. El
 * backend garantiza que `suggested_categories` **nunca viene vacío** cuando
 * `fallback` está presente —si no hay candidatos, cae a los rubros raíz con más
 * productos publicados—, así que acá no hay que inventar nada: se renderiza lo
 * que llegó.
 *
 * Devuelve `null` con la lista vacía o `fallback: null` en vez de un contenedor
 * vacío: un título «Probá por rubro» sin ningún rubro debajo es peor que no
 * mostrar nada, porque promete una salida que no existe.
 */
export function SearchFallback({
  fallback,
  titulo = 'Probá navegando por rubro',
}: {
  fallback: SearchResponse['fallback'];
  titulo?: string;
}) {
  const categorias = fallback?.suggested_categories ?? [];
  if (categorias.length === 0) return null;

  return (
    <section aria-labelledby="search-fallback-titulo" className="mt-6">
      <h2 id="search-fallback-titulo" className="text-sm font-medium text-muted">
        {titulo}
      </h2>
      <SearchFallbackClickTracker>
      <ul className="mt-2 flex flex-wrap gap-2">
        {categorias.map((categoria) => (
          <li key={categoria.slug}>
            <Link
              href={`/categorias/${categoria.slug}`}
              data-fallback-slug={categoria.slug}
              className="inline-block rounded-full border border-border px-3 py-1 text-sm focus:outline-none focus-visible:shadow-focus"
            >
              {categoria.name}
            </Link>
          </li>
        ))}
      </ul>
      </SearchFallbackClickTracker>
    </section>
  );
}
