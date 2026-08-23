import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { SearchResponse, SearchResult } from './searchService';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/cart/AddToCartButton', () => ({ AddToCartButton: () => null }));

const { SearchResults } = await import('./SearchResults');
const { SearchBar } = await import('./SearchBar');
const { SearchSkeleton } = await import('./SearchSkeleton');
const { COPY_BAJA_CONFIANZA, COPY_DEGRADADO } = await import('./SearchResults');

expect.extend(toHaveNoViolations);

function item(over: Partial<SearchResult> = {}): SearchResult {
  return {
    slug: 'taco-fischer',
    name: 'Taco Fischer SX 8mm',
    price_ars_cents: 320000,
    in_stock: true,
    image_url: 'https://cdn.example.com/taco.jpg',
    score: 0.89,
    ...over,
  };
}

const FALLBACK = {
  suggested_categories: [
    { slug: 'ferreteria', name: 'Ferretería' },
    { slug: 'electricidad', name: 'Electricidad' },
  ],
};

/** Los cuatro estados de `SearchResults`, tal como los define §D5 + AC-4. */
const ESTADOS: Array<[string, SearchResponse]> = [
  [
    'conSenal',
    {
      results: [item(), item({ slug: 'mecha', name: 'Mecha widia 8mm' })],
      confidence: 'high',
      interpreted_as: 'Buscamos en: Fijaciones',
      degraded: false,
      fallback: null,
    },
  ],
  [
    'conReserva',
    {
      results: [item()],
      confidence: 'low',
      interpreted_as: 'Buscamos en: Electricidad',
      degraded: false,
      fallback: FALLBACK,
    },
  ],
  [
    'sinSenal',
    {
      results: [],
      confidence: 'none',
      interpreted_as: null,
      degraded: false,
      fallback: FALLBACK,
    },
  ],
  [
    'degradado',
    {
      results: [item({ in_stock: false })],
      confidence: 'high',
      interpreted_as: 'Buscamos en: Ferretería',
      degraded: true,
      fallback: null,
    },
  ],
];

describe('a11y — axe sobre la experiencia de búsqueda', () => {
  it.each(ESTADOS)('sin violaciones en el estado %s', async (_nombre, response) => {
    const { container } = render(
      <SearchResults query="taco para hormigón" response={response} />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it('sin violaciones en el SearchBar', async () => {
    const { container } = render(<SearchBar />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('sin violaciones en el SearchBar con el rechazo visible', async () => {
    // El estado de error es el que suele romperse: un `aria-describedby` que
    // apunta a un id inexistente sólo aparece cuando el mensaje se muestra.
    const user = userEvent.setup();
    const { container } = render(<SearchBar />);
    await user.type(
      screen.getByRole('searchbox', { name: /buscar productos/i }),
      'a{Enter}',
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it('sin violaciones en el skeleton', async () => {
    const { container } = render(<SearchSkeleton />);

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('a11y — lo que axe no puede ver (D10)', () => {
  it('el formulario se opera sólo con teclado', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    // Axe no prueba que se pueda USAR: valida el árbol accesible, no el
    // recorrido. Tab al input y Enter para buscar es el flujo completo, y es lo
    // único que hay que poder hacer sin mouse.
    await user.tab();
    expect(screen.getByRole('searchbox', { name: /buscar productos/i })).toHaveFocus();
  });

  it('los resultados son alcanzables por teclado en el orden del ranking', async () => {
    const user = userEvent.setup();
    render(<SearchResults query="taco" response={ESTADOS[0][1]} />);

    await user.tab();
    expect(screen.getByRole('link', { name: /Taco Fischer/ })).toHaveFocus();
    await user.tab();
    // El orden de tabulación sigue al del DOM, que es el del ranking: quien
    // navega por teclado recorre los resultados de más a menos relevante, igual
    // que quien los mira.
    expect(screen.getByRole('link', { name: /Mecha widia/ })).toHaveFocus();
  });

  it('el encabezado de resultados es el h1 de la página', () => {
    render(<SearchResults query="taco" response={ESTADOS[0][1]} />);

    // Tras la navegación, quien usa lector de pantalla busca el encabezado para
    // orientarse. Si el eco de la consulta no fuera h1, aterrizaría en un
    // documento sin título propio.
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('taco');
  });

  it('el foco va al encabezado de resultados, no se queda en el input', () => {
    render(<SearchResults query="taco" response={ESTADOS[0][1]} />);

    // Sin esto, quien usa lector de pantalla presiona Enter, la página cambia
    // entera y el lector sigue parado sobre el buscador: para esa persona no
    // pasó nada. Tendría que recorrer el documento a mano para descubrir que
    // hay resultados.
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('el encabezado es enfocable por programa pero NO agrega una parada de tabulación', () => {
    render(<SearchResults query="taco" response={ESTADOS[0][1]} />);

    // `tabIndex={0}` también permitiría enfocarlo, pero le agregaría una parada
    // al recorrido de teclado de toda persona para beneficio de nadie.
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });

  it('el foco se mueve al cambiar la consulta, no en cada render', () => {
    const { rerender } = render(
      <SearchResults query="taco" response={ESTADOS[0][1]} />,
    );

    // Se saca el foco a mano y se re-renderiza con la MISMA consulta: si el
    // efecto se disparara en cada render, robaría el foco mientras la persona
    // está leyendo los resultados.
    (document.activeElement as HTMLElement).blur();
    rerender(<SearchResults query="taco" response={ESTADOS[0][1]} />);
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus();

    // Con una consulta nueva sí: es una búsqueda nueva y hay que reorientar.
    rerender(<SearchResults query="mecha" response={ESTADOS[0][1]} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('el aviso de baja confianza es TEXTO, no sólo color', () => {
    render(<SearchResults query="taco" response={ESTADOS[1][1]} />);

    // Un borde de color distinto no le dice nada a quien no lo distingue, y
    // tampoco a un lector de pantalla.
    expect(screen.getByText(COPY_BAJA_CONFIANZA)).toBeInTheDocument();
  });

  it('el aviso de degradado también es texto y se anuncia', () => {
    render(<SearchResults query="taladro" response={ESTADOS[3][1]} />);

    const aviso = screen.getByText(COPY_DEGRADADO);
    expect(aviso).toHaveAttribute('role', 'status');
  });

  it('el «sin stock» es texto y no depende del color', () => {
    render(<SearchResults query="taladro" response={ESTADOS[3][1]} />);

    expect(screen.getByText(/sin stock/i)).toBeInTheDocument();
  });
});
