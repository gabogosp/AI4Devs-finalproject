import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mockea el módulo de operaciones **generadas** (no MSW): T-B3 necesita
 * inspeccionar los *argumentos* de cada llamada (`next.revalidate`/`next.tags`),
 * no sólo el valor resuelto — MSW intercepta a nivel de red y no expone el
 * segundo argumento de `storefrontGetNewArrivals`/`storefrontGetBestSellers`
 * (`design.md` §D5, `tasks.md` T-B3).
 */
const storefrontGetNewArrivals = vi.fn();
const storefrontGetBestSellers = vi.fn();

vi.mock('@/api/generated/endpoints', () => ({
  storefrontGetNewArrivals: (...args: unknown[]) => storefrontGetNewArrivals(...args),
  storefrontGetBestSellers: (...args: unknown[]) => storefrontGetBestSellers(...args),
}));

const { homeFeaturedService } = await import('./homeFeaturedService');

function gridItem(over: Record<string, unknown> = {}) {
  return {
    slug: 'compresor-1hp',
    name: 'Compresor 1HP',
    price_ars_cents: 1250000,
    currency: 'ARS',
    image_url: null,
    in_stock: true,
    ...over,
  };
}

function okResponse(data: unknown[]) {
  return { data: { data }, status: 200 };
}

beforeEach(() => {
  storefrontGetNewArrivals.mockReset();
  storefrontGetBestSellers.mockReset();
});

describe('homeFeaturedService.getNovedades', () => {
  it('unwrappea el envelope {data} y devuelve el array plano validado contra el contrato', async () => {
    storefrontGetNewArrivals.mockResolvedValue(okResponse([gridItem()]));

    const items = await homeFeaturedService.getNovedades();

    expect(items).toEqual([gridItem()]);
  });

  it('rechaza una respuesta que no cumple el contrato', async () => {
    storefrontGetNewArrivals.mockResolvedValue(okResponse([{ slug: 'sin-precio' }]));

    await expect(homeFeaturedService.getNovedades()).rejects.toMatchObject({
      appError: { kind: 'server' },
    });
  });

  it('devuelve [] cuando el catálogo no tiene productos publicados (AC-4)', async () => {
    storefrontGetNewArrivals.mockResolvedValue(okResponse([]));

    await expect(homeFeaturedService.getNovedades()).resolves.toEqual([]);
  });
});

describe('homeFeaturedService.getMasVendidos', () => {
  it('unwrappea el envelope {data} y devuelve el array plano validado contra el contrato', async () => {
    storefrontGetBestSellers.mockResolvedValue(okResponse([gridItem({ slug: 'otro-producto' })]));

    const items = await homeFeaturedService.getMasVendidos();

    expect(items).toEqual([gridItem({ slug: 'otro-producto' })]);
  });

  it('devuelve [] cuando no hay ventas confirmadas todavía (AC-5)', async () => {
    storefrontGetBestSellers.mockResolvedValue(okResponse([]));

    await expect(homeFeaturedService.getMasVendidos()).resolves.toEqual([]);
  });
});

/**
 * Smoke de caché explícita (NFR §9, mitad FE — `design.md` §D5, T-B3): si
 * algún método omitiera `next.revalidate`/`next.tags`, este test lo detecta
 * antes de merge. Tags propios por sección — nunca un default compartido
 * (el bug de US-025 PR #139 fue exactamente heredar un TTL sin declararlo).
 */
describe('homeFeaturedService — caché explícita por método (D5)', () => {
  it('getNovedades() declara next.revalidate y next.tags propios en la llamada generada', async () => {
    storefrontGetNewArrivals.mockResolvedValue(okResponse([]));

    await homeFeaturedService.getNovedades();

    expect(storefrontGetNewArrivals).toHaveBeenCalledTimes(1);
    const [options] = storefrontGetNewArrivals.mock.calls[0];
    expect(options.next.revalidate).toBeDefined();
    expect(options.next.revalidate).toBe(60);
    expect(Array.isArray(options.next.tags)).toBe(true);
    expect(options.next.tags.length).toBeGreaterThan(0);
    expect(options.next.tags).toEqual(['home:novedades']);
  });

  it('getMasVendidos() declara next.revalidate y next.tags propios en la llamada generada', async () => {
    storefrontGetBestSellers.mockResolvedValue(okResponse([]));

    await homeFeaturedService.getMasVendidos();

    expect(storefrontGetBestSellers).toHaveBeenCalledTimes(1);
    const [options] = storefrontGetBestSellers.mock.calls[0];
    expect(options.next.revalidate).toBeDefined();
    expect(options.next.revalidate).toBe(60);
    expect(Array.isArray(options.next.tags)).toBe(true);
    expect(options.next.tags.length).toBeGreaterThan(0);
    expect(options.next.tags).toEqual(['home:mas-vendidos']);
  });

  it('los tags de cada sección son independientes entre sí (no un default compartido)', async () => {
    storefrontGetNewArrivals.mockResolvedValue(okResponse([]));
    storefrontGetBestSellers.mockResolvedValue(okResponse([]));

    await homeFeaturedService.getNovedades();
    await homeFeaturedService.getMasVendidos();

    const [novedadesOptions] = storefrontGetNewArrivals.mock.calls[0];
    const [masVendidosOptions] = storefrontGetBestSellers.mock.calls[0];
    expect(novedadesOptions.next.tags).not.toEqual(masVendidosOptions.next.tags);
  });
});
