import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  refreshOnce,
  resetRefreshState,
  sanitizeNext,
  setOnSessionLost,
} from './customerSession';

/**
 * US-014 T0.6 — G-2. El criterio se cuenta sobre **requests reales**, no sobre
 * llamadas a una función: si alguien quita el coalescing, el contador sube y el
 * test falla. Contar invocaciones internas pasaría igual.
 */
describe('refreshOnce (G-2: single-flight)', () => {
  let refreshCount = 0;

  beforeEach(() => {
    refreshCount = 0;
    resetRefreshState();
    setOnSessionLost(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetRefreshState();
  });

  /** `fetch` que cuenta y resuelve cuando el test lo decide. */
  function stubRefresh(status = 200) {
    let liberar: () => void = () => {};
    const bloqueo = new Promise<void>((r) => {
      liberar = r;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        refreshCount += 1;
        await bloqueo;
        return new Response(status === 204 ? '' : '{}', { status });
      }),
    );
    return { liberar };
  }

  it('cinco llamadas concurrentes producen UN solo POST de refresh', async () => {
    const { liberar } = stubRefresh();

    const todas = Promise.all([
      refreshOnce(),
      refreshOnce(),
      refreshOnce(),
      refreshOnce(),
      refreshOnce(),
    ]);
    liberar();
    await todas;

    expect(refreshCount).toBe(1);
  });

  it('las cinco reciben el resultado del mismo refresh (nadie queda colgado)', async () => {
    const { liberar } = stubRefresh();

    const resultados = Promise.allSettled([refreshOnce(), refreshOnce(), refreshOnce()]);
    liberar();

    expect((await resultados).every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('tras terminar, un refresh posterior SÍ dispara uno nuevo', async () => {
    const primero = stubRefresh();
    const p = refreshOnce();
    primero.liberar();
    await p;

    const segundo = stubRefresh();
    const q = refreshOnce();
    segundo.liberar();
    await q;

    // Dos requests en total: la segunda tanda NO quedó pegada a la promesa
    // vieja. Si el `inFlight` no se limpiara al terminar, sería 1 y la sesión
    // no podría renovarse nunca más.
    expect(refreshCount).toBe(2);
  });

  it('si el refresh falla, avisa que la sesión se perdió y propaga el error', async () => {
    const perdida = vi.fn();
    setOnSessionLost(perdida);
    const { liberar } = stubRefresh(401);

    const p = refreshOnce();
    liberar();

    await expect(p).rejects.toThrow(/refresh-failed:401/);
    expect(perdida).toHaveBeenCalledTimes(1);
  });

  it('el refresh NO se reintenta ante error de red', async () => {
    let intentos = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        intentos += 1;
        throw new TypeError('offline');
      }),
    );

    // Reintentar un token de un solo uso es justo lo que el backend lee como
    // reuso: preferimos fallar y que el usuario reintente a mano.
    await expect(refreshOnce()).rejects.toBeTruthy();
    expect(intentos).toBe(1);
  });

  it('manda el header CSRF cuando la cookie está', async () => {
    document.cookie = 'dsm_csrf=csrf-abc; Path=/';
    const spy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', spy);

    await refreshOnce();

    const headers = new Headers(spy.mock.calls[0][1]?.headers);
    expect(headers.get('x-csrf-token')).toBe('csrf-abc');
    document.cookie = 'dsm_csrf=; Max-Age=0; Path=/';
  });

  it('la llamada sale con credentials include y contra el origen del sitio', async () => {
    const spy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', spy);

    await refreshOnce();

    expect(spy.mock.calls[0][0]).toBe('/v1/auth/refresh');
    expect(spy.mock.calls[0][1]?.credentials).toBe('include');
  });
});

describe('sanitizeNext (open redirect)', () => {
  it('acepta una ruta relativa', () => {
    expect(sanitizeNext('/mi-cuenta')).toBe('/mi-cuenta');
  });

  it('descarta una URL absoluta', () => {
    expect(sanitizeNext('https://evil.tld/phishing')).toBe('/');
  });

  it('descarta el protocol-relative //evil.tld', () => {
    // Sin esquema pero igual de absoluta: el navegador la resuelve al host ajeno.
    expect(sanitizeNext('//evil.tld')).toBe('/');
  });

  it('sin valor devuelve la raíz', () => {
    expect(sanitizeNext(null)).toBe('/');
    expect(sanitizeNext(undefined)).toBe('/');
    expect(sanitizeNext('')).toBe('/');
  });
});
