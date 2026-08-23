import { beforeEach, describe, expect, it, vi } from 'vitest';

type Tree = { slug: string; name: string; children: { slug: string; name: string }[] }[];

let treeOk = true;
let tree: Tree = [];
let slugsByCategory: Record<string, string[]> = {};
const listAllSlugsCalls: string[] = [];

vi.mock('./categoriesStorefrontService', () => ({
  categoriesStorefrontService: {
    getTree: async () => {
      if (!treeOk) throw new Error('backend caído');
      return tree;
    },
    listAllSlugs: async (slug: string) => {
      listAllSlugsCalls.push(slug);
      return slugsByCategory[slug] ?? [];
    },
  },
}));

const { buildSitemap } = await import('./sitemap');

beforeEach(() => {
  treeOk = true;
  listAllSlugsCalls.length = 0;
  tree = [
    {
      slug: 'climatizacion',
      name: 'Climatización',
      children: [
        { slug: 'compresores', name: 'Compresores' },
        { slug: 'split', name: 'Split' },
      ],
    },
    { slug: 'ferreteria', name: 'Ferretería', children: [] },
  ];
  slugsByCategory = {
    compresores: ['compresor-1hp', 'compresor-2hp'],
    split: ['split-3000'],
    ferreteria: ['taladro'],
  };
});

describe('buildSitemap (AC-4)', () => {
  it('incluye home, todos los rubros y todos los subrubros', async () => {
    const urls = (await buildSitemap()).map((e) => e.url);

    expect(urls.some((u) => u.endsWith('/categorias/climatizacion'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/categorias/compresores'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/categorias/split'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/categorias/ferreteria'))).toBe(true);
  });

  it('recorre sólo las HOJAS: ninguna ficha aparece dos veces', async () => {
    const urls = (await buildSitemap()).map((e) => e.url);

    // Un rubro agrega los productos de sus subrubros (D1 del backend): pedirle
    // los productos a 'climatizacion' Y a sus hijos duplicaría cada ficha.
    expect(listAllSlugsCalls).not.toContain('climatizacion');
    expect(listAllSlugsCalls.sort()).toEqual(['compresores', 'ferreteria', 'split']);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('incluye todas las fichas publicadas, con URL absoluta', async () => {
    const urls = (await buildSitemap()).map((e) => e.url);

    for (const slug of ['compresor-1hp', 'compresor-2hp', 'split-3000', 'taladro']) {
      expect(urls.some((u) => u.endsWith(`/productos/${slug}`))).toBe(true);
    }
    expect(urls.every((u) => u.startsWith('http'))).toBe(true);
  });

  it('no expone ninguna URL del panel', async () => {
    const urls = (await buildSitemap()).map((e) => e.url);

    expect(urls.some((u) => u.includes('/admin'))).toBe(false);
  });

  it('si el árbol falla devuelve al menos la home, no un 500', async () => {
    treeOk = false;

    const entries = await buildSitemap();

    // Un sitemap que responde 500 le enseña al crawler a no volver.
    //
    // Se asserta "al menos la home" —que es lo que el nombre del test declara—
    // y no un conteo exacto: US-017 sumó las páginas legales al camino
    // degradado a propósito, porque no dependen del árbol. Un `toHaveLength(1)`
    // ataba el test a la cantidad de rutas que no dependen de la API, que crece
    // con cada US.
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.url === 'http://localhost:3000')).toBe(true);
    expect(entries.every((e) => e.url.startsWith('http'))).toBe(true);
  });

  it('si falla el listado de UNA categoría, el resto del sitemap sobrevive', async () => {
    slugsByCategory = { compresores: ['compresor-1hp'], ferreteria: ['taladro'] };

    const urls = (await buildSitemap()).map((e) => e.url);

    expect(urls.some((u) => u.endsWith('/productos/compresor-1hp'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/productos/taladro'))).toBe(true);
  });

  it('incluye las dos URLs legales, absolutas (US-017 AC-1/AC-2)', async () => {
    const urls = (await buildSitemap()).map((e) => e.url);

    expect(urls.some((u) => u.endsWith('/legales/privacidad'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/legales/terminos'))).toBe(true);
    expect(urls.every((u) => u.startsWith('http'))).toBe(true);
  });

  it('las legales SOBREVIVEN la degradación del árbol', async () => {
    treeOk = false;

    const urls = (await buildSitemap()).map((e) => e.url);

    // Si se agregaran después del `return` de degradación, un 5xx de la API
    // las borraría del sitemap — justo las páginas que siempre deben poder
    // encontrarse.
    expect(urls).toHaveLength(3);
    expect(urls.some((u) => u.endsWith('/legales/privacidad'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/legales/terminos'))).toBe(true);
  });

  it('no se duplican con ninguna otra URL', async () => {
    const urls = (await buildSitemap()).map((e) => e.url);

    expect(new Set(urls).size).toBe(urls.length);
  });
});
