import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import {
  PRODUCT_REVALIDATE_SECONDS,
  productTag,
  storefrontService,
  type StorefrontProduct,
} from './storefrontService';

const API = 'http://localhost:3000';

function storefrontProduct(over: Partial<StorefrontProduct> = {}): StorefrontProduct {
  return {
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

describe('storefrontService.getProductBySku', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('devuelve el producto validado contra el contrato', async () => {
    server.use(
      http.get(`${API}/v1/products/REF-001`, () =>
        HttpResponse.json(storefrontProduct()),
      ),
    );

    const product = await storefrontService.getProductBySku('REF-001');

    expect(product.name).toBe('Heladera exhibidora');
    expect(product.price_ars_cents).toBe(1250000);
    expect(product.category.name).toBe('Refrigeración');
  });

  it('propaga notFound cuando el contrato responde 404 (draft/archivado/inexistente)', async () => {
    server.use(
      http.get(`${API}/v1/products/NOPE`, () =>
        HttpResponse.json(
          { type: 'dsm:catalog/not-found', status: 404, detail: 'No existe' },
          { status: 404 },
        ),
      ),
    );

    await expect(storefrontService.getProductBySku('NOPE')).rejects.toMatchObject({
      appError: { kind: 'notFound' },
    });
  });

  it('mapea un 500 a error de servidor sin filtrar el body crudo', async () => {
    server.use(
      http.get(`${API}/v1/products/REF-001`, () =>
        HttpResponse.json({ detail: 'stacktrace interno' }, { status: 500 }),
      ),
    );

    await expect(
      storefrontService.getProductBySku('REF-001'),
    ).rejects.toMatchObject({
      appError: { kind: 'server' },
    });
    await expect(
      storefrontService.getProductBySku('REF-001'),
    ).rejects.not.toMatchObject({
      appError: { message: 'stacktrace interno' },
    });
  });

  it('rechaza una respuesta que no cumple el contrato', async () => {
    server.use(
      http.get(`${API}/v1/products/REF-001`, () =>
        HttpResponse.json({ sku: 'REF-001', name: 'Sin precio' }),
      ),
    );

    await expect(storefrontService.getProductBySku('REF-001')).rejects.toMatchObject(
      { appError: { kind: 'server' } },
    );
  });

  it('etiqueta el fetch con product:{sku} y el safety-net de 1h (AC-9)', async () => {
    const fetchSpy = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(storefrontProduct()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await storefrontService.getProductBySku('REF-001');

    expect(fetchSpy.mock.calls[0][1].next).toEqual({
      revalidate: PRODUCT_REVALIDATE_SECONDS,
      tags: [productTag('REF-001')],
    });
    expect(productTag('REF-001')).toBe('product:REF-001');
    expect(PRODUCT_REVALIDATE_SECONDS).toBe(3600);
  });
});
