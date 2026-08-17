import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customFetch } from './client';
import { setAuthToken } from './authToken';
import { AppErrorException } from './errors';

/**
 * Comportamiento del cliente **en el browser** (entorno jsdom por defecto).
 * El contrato del panel (US-001) no cambia con el storefront: token,
 * traceparent y traducción RFC 7807 siguen intactos.
 */
function stubFetch(response: Response) {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('customFetch (browser)', () => {
  beforeEach(() => setAuthToken(null));
  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthToken(null);
  });

  it('inyecta traceparent y Authorization cuando hay sesión', async () => {
    setAuthToken('tok-123');
    const spy = stubFetch(jsonResponse({ ok: true }));

    await customFetch('/v1/admin/products');

    const headers = new Headers(spy.mock.calls[0][1].headers);
    expect(headers.get('authorization')).toBe('Bearer tok-123');
    expect(headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('reenvía las opciones de caché del caller al fetch subyacente', async () => {
    const spy = stubFetch(jsonResponse({ ok: true }));

    await customFetch('/v1/products/REF-001', {
      next: { revalidate: 3600, tags: ['product:REF-001'] },
    });

    expect(spy.mock.calls[0][1].next).toEqual({
      revalidate: 3600,
      tags: ['product:REF-001'],
    });
  });

  it('traduce un problem+json a AppError tipado sin filtrar el body crudo', async () => {
    stubFetch(
      jsonResponse({ title: 'No encontrado', detail: 'No existe', status: 404 }, 404),
    );

    await expect(customFetch('/v1/products/NOPE')).rejects.toMatchObject({
      appError: { kind: 'notFound' },
    });
  });

  it('mapea una falla de red a AppError network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    await expect(customFetch('/v1/products/REF-001')).rejects.toBeInstanceOf(
      AppErrorException,
    );
  });
});
