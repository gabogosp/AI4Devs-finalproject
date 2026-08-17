// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { customFetch } from './client';
import { setAuthToken } from './authToken';

/**
 * Comportamiento del cliente **en servidor** (Server Components del storefront).
 * Sin `window`: no se inyecta Authorization (superficie pública) ni traceparent
 * (un header aleatorio por render entra en la clave de la Data Cache de Next y
 * anularía `revalidate`/`tags` — AC-9 dejaría de sostenerse).
 */
function stubFetch() {
  // Una Response nueva por llamada: el body de una Response sólo se lee una vez.
  const spy = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('customFetch (servidor)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthToken(null);
  });

  it('corre sin window y no lanza', async () => {
    expect(typeof window).toBe('undefined');
    stubFetch();

    await expect(customFetch('/v1/products/REF-001')).resolves.toMatchObject({
      status: 200,
    });
  });

  it('no inyecta Authorization ni traceparent aunque haya token en memoria', async () => {
    setAuthToken('tok-del-panel');
    const spy = stubFetch();

    await customFetch('/v1/products/REF-001');

    const headers = new Headers(spy.mock.calls[0][1].headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('traceparent')).toBeNull();
  });

  it('reenvía revalidate y tags para que la Data Cache los use', async () => {
    const spy = stubFetch();

    await customFetch('/v1/products/REF-001', {
      next: { revalidate: 3600, tags: ['product:REF-001'] },
    });

    expect(spy.mock.calls[0][1].next).toEqual({
      revalidate: 3600,
      tags: ['product:REF-001'],
    });
  });

  it('dos llamadas idénticas producen los mismos headers (clave de caché estable)', async () => {
    const spy = stubFetch();

    await customFetch('/v1/products/REF-001');
    await customFetch('/v1/products/REF-001');

    const first = [...new Headers(spy.mock.calls[0][1].headers).entries()].sort();
    const second = [...new Headers(spy.mock.calls[1][1].headers).entries()].sort();
    expect(first).toEqual(second);
  });
});
