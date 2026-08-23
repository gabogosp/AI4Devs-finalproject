import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SearchResponse } from './searchService';

vi.mock('@/features/cart/AddToCartButton', () => ({ AddToCartButton: () => null }));

let resultado: SearchResponse;

vi.mock('./searchService', () => ({
  searchService: { search: async () => resultado },
}));

vi.mock('@/features/storefront/categoriesStorefrontService', () => ({
  categoriesStorefrontService: {
    getTree: async () => [{ slug: 'ferreteria', name: 'Ferretería', children: [] }],
  },
}));

const BuscarPage = (await import('../../../app/(storefront)/buscar/page')).default;

beforeEach(() => {
  resultado = {
    results: [
      {
        slug: 'taco-fischer-sx-8mm-x50',
        name: 'Taco Fischer SX 8mm (x50)',
        price_ars_cents: 320000,
        in_stock: true,
        image_url: null,
        score: 0.89,
      },
      {
        slug: 'mecha-widia-8mm',
        name: 'Mecha widia 8mm para hormigón',
        price_ars_cents: 540000,
        in_stock: true,
        image_url: null,
        score: 0.81,
      },
    ],
    confidence: 'high',
    interpreted_as: 'Buscamos en: Fijaciones, Mechas y brocas',
    degraded: false,
    fallback: null,
  };
});

/**
 * Renderiza la ruta a **markup de servidor**, sin hidratación ni efectos.
 *
 * Es la diferencia con `buscarPage.test.tsx`: aquél monta el árbol en jsdom, así
 * que un componente que llenara la pantalla desde un `useEffect` pasaría igual.
 * Acá corre sólo lo que el servidor emite, que es lo que recibe alguien con JS
 * deshabilitado — y lo que ve un crawler que no ejecuta scripts.
 */
async function htmlServido(q: string) {
  const ui = await BuscarPage({ searchParams: Promise.resolve({ q }) });
  return renderToStaticMarkup(ui);
}

describe('/buscar — el contenido no depende de JS (D2)', () => {
  it('los nombres de los resultados salen en el HTML del servidor', async () => {
    const html = await htmlServido('taco para pared de hormigón');

    expect(html).toContain('Taco Fischer SX 8mm (x50)');
    expect(html).toContain('Mecha widia 8mm para hormigón');
  });

  it('los enlaces a las fichas salen en el HTML del servidor', async () => {
    const html = await htmlServido('taco para pared de hormigón');

    // Con `follow` en el metadata, éstos son los enlaces que transmiten a las
    // páginas que sí queremos indexadas. Si sólo existieran tras la hidratación,
    // el `follow` no serviría de nada.
    expect(html).toContain('href="/productos/taco-fischer-sx-8mm-x50"');
    expect(html).toContain('href="/productos/mecha-widia-8mm"');
  });

  it('el eco de la consulta y la interpretación salen en el HTML', async () => {
    const html = await htmlServido('taco para pared de hormigón');

    expect(html).toContain('taco para pared de hormigón');
    expect(html).toContain('Buscamos en: Fijaciones, Mechas y brocas');
  });

  it('el precio ya viene formateado del servidor', async () => {
    const html = await htmlServido('taco');

    // Si el formateo pasara en el cliente, alguien sin JS vería el número crudo
    // en centavos o un hueco.
    expect(html).toMatch(/3\.200/);
  });

  it('se llega por URL: el SearchBar no es necesario para que la página funcione', async () => {
    // Nada de este render pasó por el formulario. Ésa es la prueba de que la
    // búsqueda es compartible y recargable (D1): un enlace pegado en WhatsApp
    // tiene que abrir los resultados.
    const html = await htmlServido('mecha widia');

    expect(html).toContain('Mecha widia 8mm para hormigón');
  });
});

describe('/buscar — los estados de degradación también salen del servidor', () => {
  it('el aviso de baja confianza y los rubros están en el HTML', async () => {
    resultado = {
      ...resultado,
      confidence: 'low',
      fallback: { suggested_categories: [{ slug: 'ferreteria', name: 'Ferretería' }] },
    };

    const html = await htmlServido('algo para la pared');

    expect(html).toContain('No estamos seguros');
    expect(html).toContain('href="/categorias/ferreteria"');
  });

  it('el estado vacío con sus rubros está en el HTML', async () => {
    resultado = {
      results: [],
      confidence: 'none',
      interpreted_as: null,
      degraded: false,
      fallback: { suggested_categories: [{ slug: 'ferreteria', name: 'Ferretería' }] },
    };

    const html = await htmlServido('algo que no existe');

    // AC-3 sin JS: la salida de emergencia es lo último que puede depender de
    // que el navegador ejecute scripts.
    expect(html).toContain('No encontramos productos');
    expect(html).toContain('href="/categorias/ferreteria"');
  });

  it('el banner de degradado está en el HTML junto a los resultados', async () => {
    resultado = { ...resultado, degraded: true };

    const html = await htmlServido('taladro');

    expect(html).toContain('buscando por texto');
    expect(html).toContain('Taco Fischer SX 8mm (x50)');
  });
});
