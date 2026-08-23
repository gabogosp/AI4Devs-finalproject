import type { Metadata } from 'next';
import { searchService } from '@/features/search/searchService';
import { SearchResults } from '@/features/search/SearchResults';
import { SearchFallback } from '@/features/search/SearchFallback';
import {
  INVITACION_CONSULTA_CORTA,
  searchErrorCopy,
} from '@/features/search/searchErrorCopy';
import { esConsultaUtil, normalizar } from '@/features/search/queryGuard';
import { categoriesStorefrontService } from '@/features/storefront/categoriesStorefrontService';
import { isAppError } from '@/lib/http/errors';

export const COPY_ESTADO_INICIAL =
  'Contanos qué necesitás resolver y buscamos el producto. Si preferís, mirá los rubros.';

/**
 * Página de resultados (`design.md` D1: la URL es el estado de la búsqueda).
 *
 * Server Component que lee `searchParams`, de modo que la búsqueda queda
 * compartible, recargable y con el botón atrás funcionando sin una línea de
 * estado global — y, sobre todo, con los resultados **en el HTML servido**, que
 * es la premisa del ticket (D2).
 *
 * **Nunca llama a `notFound()`**: una consulta siempre produce una página. Eso
 * es lo que habilita el `loading.tsx` de este segmento (D3) sin caer en el
 * soft-200 de F59.
 */

/** Rubros para la salida de emergencia, en la forma que espera `SearchFallback`. */
async function rubrosSugeridos() {
  const tree = await categoriesStorefrontService.getTree().catch(() => []);
  return tree.length > 0
    ? { suggested_categories: tree.map((r) => ({ slug: r.slug, name: r.name })) }
    : null;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const q = normalizar((await searchParams)?.q ?? '');
  return {
    title: q ? `Buscar: ${q}` : 'Buscar productos',
    robots: {
      // OQ-FE-2: una página de resultados por consulta es contenido delgado y
      // duplicado; indexarla canibaliza a las fichas y a las categorías, que sí
      // son los activos indexables.
      index: false,
      // Pero `follow` sí, para que los enlaces a las fichas transmitan.
      follow: true,
    },
  };
}

export default async function BuscarPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const crudo = (await searchParams)?.q ?? '';
  const q = normalizar(crudo);

  // AC-5 también fuera del formulario: a `?q=a` se llega escribiendo la URL a
  // mano, y sin este guard la búsqueda costosa se ejecutaría igual. El
  // `SearchBar` ataja el caso normal; esto ataja el resto.
  if (!esConsultaUtil(q)) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <h1 className="text-xl font-semibold">Buscar productos</h1>
        <p className="mt-2 text-sm">
          {q ? INVITACION_CONSULTA_CORTA : COPY_ESTADO_INICIAL}
        </p>
        <SearchFallback fallback={await rubrosSugeridos()} titulo="Mirá los rubros" />
      </div>
    );
  }

  let response;
  try {
    response = await searchService.search(q);
  } catch (error: unknown) {
    if (!isAppError(error)) throw error;
    // Un 429 o un 503 NO tumban la página: se explican y se deja por dónde
    // seguir. Relanzar acá mandaría al error boundary, que es una pantalla sin
    // salida para algo que el backend ya dijo cómo resolver (AC-10).
    return (
      <div className="mx-auto max-w-5xl p-4">
        <h1 className="text-xl font-semibold">Resultados para: “{q}”</h1>
        <p role="status" className="mt-3 rounded-md border border-border p-3 text-sm">
          {searchErrorCopy(error.appError)}
        </p>
        <SearchFallback
          fallback={await rubrosSugeridos()}
          titulo="Mientras tanto, mirá los rubros"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <SearchResults query={q} response={response} />
    </div>
  );
}
