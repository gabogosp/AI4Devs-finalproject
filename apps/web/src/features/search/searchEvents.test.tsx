import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setEventSink } from '@/lib/observability/events';
import type { SearchResponse, SearchResult } from './searchService';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/cart/AddToCartButton', () => ({ AddToCartButton: () => null }));

const { SearchResults } = await import('./SearchResults');
const { SearchFallback } = await import('./SearchFallback');
const { SearchRateLimitTracker } = await import('./SearchTracker');

const eventos: Array<{ event: string; props: Record<string, unknown> }> = [];

/**
 * Los clics de esta suite caen sobre `<a href>` reales, y jsdom no implementa
 * navegación: sin esto cada clic escribe un «Not implemented: navigation» en
 * stderr. Se cancela la navegación en captura, no la propagación, así que el
 * listener por delegación —que es justamente lo que se está probando— corre
 * igual.
 */
function frenarNavegacion(e: Event) {
  if ((e.target as HTMLElement).closest('a')) e.preventDefault();
}

beforeEach(() => {
  eventos.length = 0;
  setEventSink((event, props) => eventos.push({ event, props }));
  document.addEventListener('click', frenarNavegacion);
});
afterEach(() => {
  document.removeEventListener('click', frenarNavegacion);
  setEventSink(() => {});
});

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
    results: [item(), item({ slug: 'mecha', name: 'Mecha widia 8mm' })],
    confidence: 'high',
    interpreted_as: 'Buscamos en: Fijaciones',
    degraded: false,
    fallback: null,
    ...over,
  };
}

const solo = (nombre: string) => eventos.filter((e) => e.event === nombre);

describe('search_performed', () => {
  it('se emite una sola vez por búsqueda, con las cuatro propiedades', () => {
    render(<SearchResults query="taco para hormigón" response={respuesta()} />);

    expect(solo('search_performed')).toHaveLength(1);
    expect(solo('search_performed')[0].props).toMatchObject({
      confidence: 'high',
      degraded: false,
      results_count: 2,
      query_length: 'taco para hormigón'.length,
    });
  });

  it('no se duplica si el mismo árbol se re-renderiza', () => {
    const { rerender } = render(
      <SearchResults query="taco" response={respuesta()} />,
    );
    rerender(<SearchResults query="taco" response={respuesta()} />);

    // El guard de StrictMode: sin él, en dev cada búsqueda contaría doble y las
    // métricas del dueño saldrían al doble de lo real.
    expect(solo('search_performed')).toHaveLength(1);
  });

  it('se re-arma al cambiar la consulta: eso SÍ es una búsqueda nueva', () => {
    const { rerender } = render(
      <SearchResults query="taco" response={respuesta()} />,
    );
    rerender(<SearchResults query="mecha widia" response={respuesta()} />);

    expect(solo('search_performed')).toHaveLength(2);
  });

  it('lleva el estado degradado, que es lo que mide el KPI', () => {
    render(<SearchResults query="taladro" response={respuesta({ degraded: true })} />);

    expect(solo('search_performed')[0].props.degraded).toBe(true);
  });
});

describe('search_result_clicked', () => {
  it('lleva la posición 1-based del resultado clickeado', async () => {
    const user = userEvent.setup();
    render(<SearchResults query="taco" response={respuesta()} />);

    await user.click(screen.getByRole('link', { name: /Mecha widia/ }));

    expect(solo('search_result_clicked')).toHaveLength(1);
    // 1-based: es lo que se lee en un panel («los clics caen en el puesto 4»).
    expect(solo('search_result_clicked')[0].props).toMatchObject({
      position: 2,
      confidence: 'high',
    });
  });

  it('también se emite activando el enlace con el teclado', async () => {
    const user = userEvent.setup();
    render(<SearchResults query="taco" response={respuesta()} />);

    // Esto es lo que justifica escuchar por delegación en un contenedor en vez
    // de poner el handler en cada tarjeta: Enter sobre el `<a>` dispara un
    // `click` que burbuja igual que el del mouse. Si el evento sólo saliera con
    // el mouse, quien navega por teclado sería invisible para la métrica de
    // relevancia y el ranking se ajustaría con datos sesgados.
    screen.getByRole('link', { name: /Mecha widia/ }).focus();
    await user.keyboard('{Enter}');

    expect(solo('search_result_clicked')[0].props).toMatchObject({ position: 2 });
  });

  it('un clic fuera de una tarjeta no emite nada', async () => {
    const user = userEvent.setup();
    render(<SearchResults query="taco" response={respuesta()} />);

    await user.click(screen.getByRole('heading', { level: 1 }));

    expect(solo('search_result_clicked')).toHaveLength(0);
  });
});

describe('search_fallback_clicked', () => {
  it('lleva el slug del rubro elegido', async () => {
    const user = userEvent.setup();
    render(
      <SearchFallback
        fallback={{
          suggested_categories: [
            { slug: 'electricidad', name: 'Electricidad' },
            { slug: 'ferreteria', name: 'Ferretería' },
          ],
        }}
      />,
    );

    await user.click(screen.getByRole('link', { name: 'Ferretería' }));

    expect(solo('search_fallback_clicked')).toHaveLength(1);
    expect(solo('search_fallback_clicked')[0].props).toMatchObject({
      category_slug: 'ferreteria',
    });
  });
});

describe('search_rate_limited', () => {
  it('lleva la espera que mandó el backend', () => {
    render(<SearchRateLimitTracker retryAfterSeconds={30} />);

    expect(solo('search_rate_limited')[0].props).toMatchObject({
      retry_after_seconds: 30,
    });
  });

  it('sin Retry-After manda null y no un número inventado', () => {
    render(<SearchRateLimitTracker />);

    expect(solo('search_rate_limited')[0].props.retry_after_seconds).toBeNull();
  });
});

describe('OQ-FE-5: el texto de la consulta NO viaja en la telemetría', () => {
  /**
   * El input es entrada libre. Si el texto viajara, alguien que pega su email o
   * su teléfono ahí convertiría el volcado de telemetría en un registro de PII
   * (`observability-standards` §9).
   */
  const CONSULTA = 'ana.perez@example.com necesito un taco fischer 11-2233-4455';

  it('ningún evento contiene la consulta ni un fragmento suyo', async () => {
    const user = userEvent.setup();
    render(
      <SearchResults
        query={CONSULTA}
        response={respuesta({
          confidence: 'low',
          fallback: { suggested_categories: [{ slug: 'ferreteria', name: 'Ferretería' }] },
        })}
      />,
    );
    await user.click(screen.getByRole('link', { name: /Taco Fischer/ }));
    await user.click(screen.getByRole('link', { name: 'Ferretería' }));
    render(<SearchRateLimitTracker retryAfterSeconds={30} />);

    expect(eventos.length).toBeGreaterThan(0);
    const volcado = JSON.stringify(eventos);

    // No alcanza con buscar la consulta entera: un truncado a 20 caracteres
    // seguiría llevando el email. Se buscan los fragmentos que duelen.
    expect(volcado).not.toContain(CONSULTA);
    expect(volcado).not.toContain('ana.perez');
    expect(volcado).not.toContain('example.com');
    expect(volcado).not.toContain('11-2233-4455');
    expect(volcado).not.toContain('taco fischer');
  });

  it('lo que sí viaja es la longitud, que mide lo mismo sin guardar el texto', () => {
    render(<SearchResults query={CONSULTA} response={respuesta()} />);

    expect(solo('search_performed')[0].props.query_length).toBe(CONSULTA.length);
  });
});

describe('los cuatro eventos son de superficie pública', () => {
  it('no se etiquetan como acción del dueño', async () => {
    const user = userEvent.setup();
    render(
      <SearchResults
        query="taco"
        response={respuesta({
          fallback: { suggested_categories: [{ slug: 'ferreteria', name: 'Ferretería' }] },
        })}
      />,
    );
    await user.click(screen.getByRole('link', { name: /Taco Fischer/ }));
    await user.click(screen.getByRole('link', { name: 'Ferretería' }));
    render(<SearchRateLimitTracker retryAfterSeconds={5} />);

    // Sin estar en PUBLIC_EVENTS, `track` les pone `operator_id: 'admin'` y cada
    // búsqueda de un visitante anónimo quedaría contada como acción del dueño,
    // ensuciando las métricas de US-016.
    expect(eventos).toHaveLength(4);
    for (const e of eventos) {
      expect(e.props.operator_id).toBeUndefined();
    }
  });
});
