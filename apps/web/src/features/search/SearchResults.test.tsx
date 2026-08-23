import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SearchResponse, SearchResult } from './searchService';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/cart/cartService', () => ({
  cartService: { get: vi.fn(), setItemQuantity: vi.fn(), removeItem: vi.fn() },
}));

const { SearchResults, COPY_BAJA_CONFIANZA, COPY_SIN_RESULTADOS, COPY_DEGRADADO } =
  await import('./SearchResults');
const { CartProvider } = await import('@/features/cart/CartProvider');
const { derivarEstado } = await import('./searchState');

function item(over: Partial<SearchResult> = {}): SearchResult {
  return {
    slug: 'taco-fischer',
    name: 'Taco Fischer SX 8mm',
    price_ars_cents: 320000,
    in_stock: true,
    image_url: null,
    score: 0.89,
    ...over,
  };
}

function respuesta(over: Partial<SearchResponse> = {}): SearchResponse {
  return {
    results: [item()],
    confidence: 'high',
    interpreted_as: 'Buscamos en: Fijaciones',
    degraded: false,
    fallback: null,
    ...over,
  };
}

function renderResults(res: SearchResponse, query = 'taco para hormigón') {
  return render(
    <CartProvider>
      <SearchResults query={query} response={res} />
    </CartProvider>,
  );
}

const FALLBACK = {
  suggested_categories: [{ slug: 'ferreteria', name: 'Ferretería' }],
};

describe('derivarEstado (D5) — la regla, sin render', () => {
  it('high con resultados es conSenal', () => {
    expect(derivarEstado(respuesta())).toBe('conSenal');
  });

  it('low con resultados es conReserva', () => {
    expect(derivarEstado(respuesta({ confidence: 'low' }))).toBe('conReserva');
  });

  it.each([['high'], ['low'], ['none']] as const)(
    'sin resultados es sinSenal aunque el confidence sea %s',
    (confidence) => {
      expect(derivarEstado(respuesta({ results: [], confidence }))).toBe('sinSenal');
    },
  );

  it('degraded NO cambia el estado: es ortogonal (AC-4)', () => {
    // Si el degradado fuera un cuarto estado excluyente, habría que elegir entre
    // avisar que fue el plan B o avisar que no estamos seguros. Las dos cosas
    // pueden ser ciertas a la vez.
    expect(derivarEstado(respuesta({ degraded: true }))).toBe('conSenal');
    expect(derivarEstado(respuesta({ degraded: true, confidence: 'low' }))).toBe(
      'conReserva',
    );
  });
});

describe('SearchResults — confianza alta', () => {
  it('muestra la interpretación y la grilla, sin advertencias', () => {
    renderResults(respuesta());

    expect(screen.getByText('Buscamos en: Fijaciones')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Taco Fischer/ })).toBeInTheDocument();
    expect(screen.queryByText(COPY_BAJA_CONFIANZA)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY_DEGRADADO)).not.toBeInTheDocument();
  });

  it('hace eco de la consulta', () => {
    renderResults(respuesta(), 'algo para colgar un cuadro');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'algo para colgar un cuadro',
    );
  });
});

describe('SearchResults — baja confianza (§7.12: nunca como certeza)', () => {
  it('avisa, muestra igual los resultados y ofrece la salida a rubros', () => {
    renderResults(respuesta({ confidence: 'low', fallback: FALLBACK }));

    expect(screen.getByText(COPY_BAJA_CONFIANZA)).toBeInTheDocument();
    // Se muestran, no se esconden: quizás alguno sirve.
    expect(screen.getByRole('link', { name: /Taco Fischer/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ferretería' })).toBeInTheDocument();
  });

  it('el aviso está ANTES de la grilla en el DOM', () => {
    const { container } = renderResults(
      respuesta({ confidence: 'low', fallback: FALLBACK }),
    );

    const aviso = screen.getByText(COPY_BAJA_CONFIANZA);
    const grilla = screen.getByTestId('search-grid');
    // No alcanza con que el aviso exista: leerlo después de haber recorrido los
    // resultados es haberlos presentado como certeza. `compareDocumentPosition`
    // afirma el orden real del documento, que es lo que ve un lector de
    // pantalla y lo que se lee de arriba abajo en la página.
    expect(
      aviso.compareDocumentPosition(grilla) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container).toBeTruthy();
  });
});

describe('SearchResults — sin resultados (AC-3)', () => {
  it('da un mensaje afirmativo con rubros, nunca un «0 resultados» desnudo', () => {
    renderResults(
      respuesta({
        results: [],
        confidence: 'none',
        interpreted_as: null,
        fallback: FALLBACK,
      }),
    );

    expect(screen.getByText(COPY_SIN_RESULTADOS)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ferretería' })).toBeInTheDocument();
    // El callejón sin salida que AC-3 prohíbe.
    expect(screen.queryByText(/^0 resultados$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 productos encontrados/i)).not.toBeInTheDocument();
  });

  it('no renderiza una grilla vacía', () => {
    renderResults(respuesta({ results: [], confidence: 'none', fallback: FALLBACK }));

    expect(screen.queryByTestId('search-grid')).toBeNull();
  });
});

describe('SearchResults — degradado (AC-4)', () => {
  it('el banner COEXISTE con los resultados: no es un error', () => {
    renderResults(respuesta({ degraded: true }));

    expect(screen.getByText(COPY_DEGRADADO)).toBeInTheDocument();
    // Lo que importa del caso: la grilla sigue ahí. Tratar el degradado como
    // fallo rompería la navegación que AC-4 pide preservar.
    expect(screen.getByRole('link', { name: /Taco Fischer/ })).toBeInTheDocument();
  });

  it('se superpone a la baja confianza sin excluirla', () => {
    renderResults(respuesta({ degraded: true, confidence: 'low', fallback: FALLBACK }));

    expect(screen.getByText(COPY_DEGRADADO)).toBeInTheDocument();
    expect(screen.getByText(COPY_BAJA_CONFIANZA)).toBeInTheDocument();
  });
});

describe('SearchResults — AC-8: el texto de la consulta no se ejecuta', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';

  it('el eco aparece como texto literal y no crea ningún elemento', () => {
    const { container } = renderResults(respuesta(), PAYLOAD);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PAYLOAD);
    // La afirmación dura: si React hubiera interpretado el markup, acá habría
    // un <img>. Buscar el texto solo no alcanza — podría estar escapado Y
    // haberse creado el elemento por otra vía.
    expect(container.querySelector('img')).toBeNull();
  });

  it('tampoco con un script en la consulta', () => {
    const { container } = renderResults(respuesta(), '<script>alert(1)</script>');

    expect(container.querySelector('script')).toBeNull();
  });
});

describe('SearchResults — accesibilidad', () => {
  it('anuncia la cantidad de resultados en una región polite', () => {
    renderResults(respuesta({ results: [item(), item({ slug: 'mecha' })] }));

    const anuncio = screen.getByText('2 productos encontrados');
    expect(anuncio).toHaveAttribute('aria-live', 'polite');
  });

  it('concuerda el singular', () => {
    renderResults(respuesta());
    expect(screen.getByText('1 producto encontrado')).toBeInTheDocument();
  });

  it('los avisos son texto, no sólo color', () => {
    renderResults(respuesta({ degraded: true, confidence: 'low', fallback: FALLBACK }));

    // Quien no distingue los colores tiene que enterarse igual (§11).
    expect(screen.getByText(COPY_DEGRADADO).textContent?.trim().length).toBeGreaterThan(0);
    expect(screen.getByText(COPY_BAJA_CONFIANZA).textContent?.trim().length).toBeGreaterThan(0);
  });
});
