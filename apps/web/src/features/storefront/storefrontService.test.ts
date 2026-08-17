import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import {
  productTag,
  storefrontService,
  type StorefrontProduct,
} from './storefrontService';

const API = 'http://localhost:3000';

function storefrontProduct(over: Partial<StorefrontProduct> = {}): StorefrontProduct {
  return {
    slug: 'heladera-exhibidora',
    sku: 'REF-001',
    name: 'Heladera exhibidora',
    description: 'Heladera de 400 litros',
    price_ars_cents: 1250000,
    currency: 'ARS',
    image_url: null,
    in_stock: true,
    category: { name: 'Refrigeración', slug: 'refrigeracion' },
    ...over,
  };
}

describe('storefrontService.getProductBySlug', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('devuelve el producto validado contra el contrato', async () => {
    server.use(
      http.get(`${API}/v1/products/heladera-exhibidora`, () =>
        HttpResponse.json(storefrontProduct()),
      ),
    );

    const product = await storefrontService.getProductBySlug('heladera-exhibidora');

    expect(product.name).toBe('Heladera exhibidora');
    expect(product.price_ars_cents).toBe(1250000);
    expect(product.category.name).toBe('Refrigeración');
  });

  it('propaga notFound cuando el contrato responde 404 (draft/archivado/inexistente)', async () => {
    server.use(
      http.get(`${API}/v1/products/no-existe`, () =>
        HttpResponse.json(
          { type: 'dsm:catalog/not-found', status: 404, detail: 'No existe' },
          { status: 404 },
        ),
      ),
    );

    await expect(storefrontService.getProductBySlug('no-existe')).rejects.toMatchObject({
      appError: { kind: 'notFound' },
    });
  });

  it('mapea un 500 a error de servidor sin filtrar el body crudo', async () => {
    server.use(
      http.get(`${API}/v1/products/heladera-exhibidora`, () =>
        HttpResponse.json({ detail: 'stacktrace interno' }, { status: 500 }),
      ),
    );

    await expect(
      storefrontService.getProductBySlug('heladera-exhibidora'),
    ).rejects.toMatchObject({
      appError: { kind: 'server' },
    });
    await expect(
      storefrontService.getProductBySlug('heladera-exhibidora'),
    ).rejects.not.toMatchObject({
      appError: { message: 'stacktrace interno' },
    });
  });

  it('rechaza una respuesta que no cumple el contrato', async () => {
    server.use(
      http.get(`${API}/v1/products/heladera-exhibidora`, () =>
        HttpResponse.json({ sku: 'heladera-exhibidora', name: 'Sin precio' }),
      ),
    );

    await expect(storefrontService.getProductBySlug('heladera-exhibidora')).rejects.toMatchObject(
      { appError: { kind: 'server' } },
    );
  });

  it('etiqueta el fetch con product:{slug} y el safety-net de 1h (AC-9)', async () => {
    const fetchSpy = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(storefrontProduct()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await storefrontService.getProductBySlug('heladera-exhibidora');

    expect(fetchSpy.mock.calls[0][1].next).toEqual({
      revalidate: 3600,
      tags: [productTag('heladera-exhibidora')],
    });
    expect(productTag('heladera-exhibidora')).toBe('product:heladera-exhibidora');
  });
});
