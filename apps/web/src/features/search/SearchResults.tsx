import { SearchResultCard } from './SearchResultCard';
import { SearchFallback } from './SearchFallback';
import { derivarEstado } from './searchState';
import {
  SearchTracker,
  SearchResultsClickTracker,
  FocusResultsHeading,
  HEADING_ID,
} from './SearchTracker';
import type { SearchResponse } from './searchService';

export const COPY_BAJA_CONFIANZA =
  'No estamos seguros de haber entendido. Mirá si alguno de estos te sirve, o probá describiéndolo distinto.';

export const COPY_SIN_RESULTADOS =
  'No encontramos productos para esa búsqueda. Probá con otras palabras o navegá por rubro.';

export const COPY_DEGRADADO =
  'Por ahora estamos buscando por texto, así que los resultados pueden ser menos precisos.';

/**
 * La composición de la página de resultados (design-system §7.12, `design.md`
 * §D5).
 *
 * Server Component: no hay estado ni evento acá, y el contenido tiene que salir
 * en el HTML servido (D2). Las hojas cliente son `AddToCartButton` dentro de
 * cada tarjeta y el tracker, no esto.
 *
 * **El texto de la consulta se renderiza como texto en JSX** y nada más (D8).
 * React escapa por defecto y esta feature no usa ninguna vía que se saltee ese
 * escape, así que AC-8 se sostiene con esa única regla: el texto del cliente es
 * dato, nunca markup.
 */
export function SearchResults({
  query,
  response,
}: {
  query: string;
  response: SearchResponse;
}) {
  const estado = derivarEstado(response);
  const cantidad = response.results.length;

  return (
    <div>
      <SearchTracker query={query} response={response} />
      <FocusResultsHeading query={query} />

      {/*
        `tabIndex={-1}`: enfocable por programa, pero **fuera** del orden de
        tabulación. Sin el atributo, `focus()` sobre un `<h1>` no hace nada; con
        `tabIndex={0}` agregaríamos una parada más al recorrido de teclado de
        toda persona, para beneficio de nadie.
      */}
      <h1 id={HEADING_ID} tabIndex={-1} className="text-xl font-semibold">
        {/* Eco de la consulta. Interpolado como texto: una consulta con
            `<img src=x onerror=...>` aparece literal. */}
        Resultados para: “{query}”
      </h1>

      {response.interpreted_as ? (
        <p className="mt-1 text-sm text-muted">{response.interpreted_as}</p>
      ) : null}

      {/*
        Ortogonal a los tres estados (AC-4): el degradado NO es un error y
        convive con los resultados. Va antes de la grilla porque es el contexto
        con el que hay que leer lo que sigue.
      */}
      {response.degraded ? (
        <p role="status" className="mt-3 rounded-md bg-gray-100 p-3 text-sm">
          {COPY_DEGRADADO}
        </p>
      ) : null}

      {/*
        El aviso de baja confianza va ANTES de la grilla, no debajo: presentar
        primero los resultados y aclarar después que no estamos seguros es
        presentarlos como certeza, que es justo lo que §7.12 quiere evitar.
      */}
      {estado === 'conReserva' ? (
        <p className="mt-3 rounded-md border border-border p-3 text-sm">
          {COPY_BAJA_CONFIANZA}
        </p>
      ) : null}

      {estado === 'sinSenal' ? (
        <p className="mt-3 text-sm">{COPY_SIN_RESULTADOS}</p>
      ) : (
        <>
          {/*
            La cantidad se anuncia para quien no ve la grilla aparecer. `polite`
            y no `assertive`: no interrumpe lo que el lector esté diciendo.
          */}
          <p aria-live="polite" className="mt-3 text-sm text-muted">
            {cantidad === 1 ? '1 producto encontrado' : `${cantidad} productos encontrados`}
          </p>
          <SearchResultsClickTracker confidence={response.confidence}>
            <ul
              data-testid="search-grid"
              className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4"
            >
              {/*
                Sin ordenar ni filtrar: el orden es la respuesta del ranking y
                reordenarlo acá tiraría el trabajo del backend.
              */}
              {response.results.map((result, i) => (
                /*
                  `data-position` es 1-based: es lo que se lee en un panel
                  («los clics caen en el puesto 4»), y un cero ahí obligaría a
                  quien mire la métrica a acordarse de sumar uno.
                */
                <li key={result.slug} data-search-result data-position={i + 1}>
                  <SearchResultCard result={result} />
                </li>
              ))}
            </ul>
          </SearchResultsClickTracker>
        </>
      )}

      {/*
        AC-3: la salida a rubros acompaña tanto al vacío como a la baja
        confianza. Con `confidence: high` el contrato manda `fallback: null` y el
        componente devuelve `null` solo.
      */}
      <SearchFallback
        fallback={response.fallback}
        titulo={
          estado === 'sinSenal'
            ? 'Mirá estos rubros'
            : 'O probá navegando por rubro'
        }
      />
    </div>
  );
}
