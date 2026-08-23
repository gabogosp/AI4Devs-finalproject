import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppErrorException } from '@/lib/http/errors';
import type { SearchResponse } from './searchService';

// La tarjeta con stock monta `AddToCartButton`, que consume el CartProvider del
// layout. Acá se renderiza la ruta aislada: se stubea el botón y ninguna
// aserción de esta suite cambia.
vi.mock('@/features/cart/AddToCartButton', () => ({ AddToCartButton: () => null }));

/**
 * Doble con estado plano y no un spy: un `vi.fn()` que devuelve una promesa
 * rechazada la retiene en `mock.results` y vitest la reporta como unhandled
 * cuando `render()` flushea microtasks, aunque el componente la maneje.
 */
let resultado: { ok: true; value: SearchResponse } | { ok: false; error: unknown };
/** Cuántas veces se llamó al servicio: es lo que prueba AC-5, no el DOM. */
let llamadas = 0;

vi.mock('./searchService', () => ({
  searchService: {
    search: async (q: string) => {
      llamadas += 1;
      void q;
      if (!resultado.ok) throw resultado.error;
      return resultado.value;
    },
  },
}));

vi.mock('@/features/storefront/categoriesStorefrontService', () => ({
  categoriesStorefrontService: {
    getTree: async () => [
      { slug: 'ferreteria', name: 'Ferretería', children: [] },
      { slug: 'refrigeracion', name: 'Refrigeración', children: [] },
    ],
  },
}));

const BuscarPage = (await import('../../../app/(storefront)/buscar/page')).default;
const { generateMetadata, COPY_ESTADO_INICIAL } = await import(
  '../../../app/(storefront)/buscar/page'
);
const { INVITACION_CONSULTA_CORTA, COPY_NO_DISPONIBLE, copyRateLimited } = await import(
  './searchErrorCopy'
);

function respuesta(over: Partial<SearchResponse> = {}): SearchResponse {
  return {
    results: [
      {
        slug: 'taco-fischer',
        name: 'Taco Fischer SX 8mm',
        price_ars_cents: 320000,
        in_stock: true,
        image_url: null,
        score: 0.89,
      },
    ],
    confidence: 'high',
    interpreted_as: 'Buscamos en: Fijaciones',
    degraded: false,
    fallback: null,
    ...over,
  };
}

/** Renderiza la ruta como lo hace Next: `searchParams` es una promesa. */
async function renderPage(q?: string) {
  const ui = await BuscarPage({ searchParams: Promise.resolve(q === undefined ? {} : { q }) });
  return render(ui);
}

beforeEach(() => {
  llamadas = 0;
  resultado = { ok: true, value: respuesta() };
});

describe('/buscar — consulta útil', () => {
  it('renderiza los resultados en el servidor (D2: no depende de JS)', async () => {
    await renderPage('taco para hormigón');

    // El componente ya está renderizado ANTES de que corra ningún efecto: lo
    // que se ve acá es lo que sale en el HTML servido.
    expect(screen.getByRole('link', { name: /Taco Fischer/ })).toHaveAttribute(
      'href',
      '/productos/taco-fischer',
    );
    expect(llamadas).toBe(1);
  });

  it('hace eco de la consulta normalizada', async () => {
    await renderPage('  taco   fischer  ');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Resultados para: “taco fischer”',
    );
  });
});

describe('/buscar — AC-5 fuera del formulario', () => {
  it.each([['a'], ['  '], ['  a  '], ['']])(
    'con ?q=%j NO llama al servicio',
    async (q) => {
      await renderPage(q);

      // Ésta es la aserción de AC-5, y vale para las cuatro formas: a `?q=a` se
      // llega escribiendo la URL a mano, sin pasar por el SearchBar. Si el
      // guard viviera sólo en el formulario, AC-5 valdría para el caso normal y
      // no para el resto.
      expect(llamadas).toBe(0);
    },
  );

  it.each([['a'], ['  a  ']])(
    'con ?q=%j explica que falta texto',
    async (q) => {
      await renderPage(q);
      expect(screen.getByText(INVITACION_CONSULTA_CORTA)).toBeInTheDocument();
    },
  );

  it('con ?q= sólo espacios muestra el estado inicial, no el reproche', async () => {
    // Normalizado queda vacío, o sea que la persona no escribió nada.
    // «Contanos un poco más» supone que escribió algo corto y suena a reproche
    // por un texto que no existe; el estado inicial es lo que corresponde.
    await renderPage('   ');

    expect(screen.getByText(COPY_ESTADO_INICIAL)).toBeInTheDocument();
    expect(screen.queryByText(INVITACION_CONSULTA_CORTA)).not.toBeInTheDocument();
  });

  it('sin `q` muestra el estado inicial con acceso a rubros', async () => {
    await renderPage(undefined);

    expect(llamadas).toBe(0);
    expect(screen.getByText(COPY_ESTADO_INICIAL)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ferretería' })).toHaveAttribute(
      'href',
      '/categorias/ferreteria',
    );
  });

  it('la consulta corta también ofrece los rubros, no deja sin salida', async () => {
    await renderPage('a');

    expect(screen.getByRole('link', { name: 'Refrigeración' })).toBeInTheDocument();
  });
});

describe('/buscar — errores: la página sigue navegable (AC-10)', () => {
  it('un 429 se explica con la espera y ofrece rubros', async () => {
    resultado = {
      ok: false,
      error: new AppErrorException({
        kind: 'rateLimited',
        message: 'crudo del servidor',
        retryAfterSeconds: 30,
      }),
    };

    await renderPage('taco fischer');

    expect(screen.getByText(copyRateLimited(30))).toBeInTheDocument();
    // Navegable: la salida a rubros sigue estando. Relanzar el error mandaría
    // al boundary, que es una pantalla sin salida para algo que el backend ya
    // dijo cómo resolver.
    expect(screen.getByRole('link', { name: 'Ferretería' })).toBeInTheDocument();
  });

  it('un 503 se explica y la página no se cae', async () => {
    resultado = {
      ok: false,
      error: new AppErrorException({ kind: 'server', message: 'crudo del servidor' }),
    };

    await renderPage('taco fischer');

    expect(screen.getByText(COPY_NO_DISPONIBLE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ferretería' })).toBeInTheDocument();
  });

  it('el mensaje crudo del servidor no llega a la pantalla', async () => {
    resultado = {
      ok: false,
      error: new AppErrorException({ kind: 'server', message: 'ECONNREFUSED 10.0.0.4:5432' }),
    };

    const { container } = await renderPage('taco fischer');

    expect(container.textContent).not.toContain('ECONNREFUSED');
  });

  it('un error que no es AppError sí sube al boundary', async () => {
    // No todo se traga: un bug nuestro tiene que llegar al error boundary y no
    // disfrazarse de «la búsqueda no está disponible».
    resultado = { ok: false, error: new TypeError('bug de programación') };

    await expect(renderPage('taco fischer')).rejects.toThrow('bug de programación');
  });
});

describe('/buscar — metadata (D2)', () => {
  it('declara noindex, follow', async () => {
    const meta = await generateMetadata({
      searchParams: Promise.resolve({ q: 'taco fischer' }),
    });

    const robots = meta.robots as { index: boolean; follow: boolean };
    // `index: false` porque una página por consulta es contenido delgado que
    // canibaliza a las fichas; `follow: true` para que los enlaces transmitan.
    expect(robots.index).toBe(false);
    expect(robots.follow).toBe(true);
  });

  it('el title lleva el eco de la consulta', async () => {
    const meta = await generateMetadata({
      searchParams: Promise.resolve({ q: '  taco   fischer ' }),
    });

    expect(meta.title).toBe('Buscar: taco fischer');
  });

  it('sin consulta el title es genérico y no queda colgado', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({}) });

    expect(meta.title).toBe('Buscar productos');
  });
});
