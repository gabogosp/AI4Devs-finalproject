import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AUDIT-DSM-WEB-003 + AUDIT-DSM-WEB-011.
 *
 * Lo que hay que probar no es que el archivo exista —eso ya pasaba y el módulo era un
 * no-op igual— sino el **comportamiento en los dos modos**: sin DSN no arranca nada y
 * no explota; con DSN, el SDK se inicializa de verdad y `captureError` llega a
 * `captureException`. Antes de este cableado, los error boundaries llamaban a
 * `captureError` y el error se perdía en silencio.
 */
const init = vi.fn();
const captureException = vi.fn();
const addBreadcrumb = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  init: (...a: unknown[]) => init(...a),
  captureException: (...a: unknown[]) => captureException(...a),
  addBreadcrumb: (...a: unknown[]) => addBreadcrumb(...a),
}));

const DSN_ORIGINAL = process.env.NEXT_PUBLIC_SENTRY_DSN;

beforeEach(() => {
  vi.resetModules();
  init.mockReset();
  captureException.mockReset();
  addBreadcrumb.mockReset();
});

afterEach(() => {
  if (DSN_ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = DSN_ORIGINAL;
});

describe('initObservability', () => {
  it('sin DSN no inicializa el SDK y no lanza (caso local y de test)', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const { initObservability } = await import('./sentry');

    expect(() => initObservability()).not.toThrow();
    expect(init).not.toHaveBeenCalled();
  });

  it('con DSN inicializa el SDK, sin PII y con muestreo de trazas acotado', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://clave@o0.ingest.sentry.io/1';
    const { initObservability } = await import('./sentry');

    initObservability();

    expect(init).toHaveBeenCalledTimes(1);
    const cfg = init.mock.calls[0][0] as Record<string, unknown>;
    expect(cfg.dsn).toBe('https://clave@o0.ingest.sentry.io/1');
    // La disciplina de PII del proyecto: ni IP ni cookies en el evento.
    expect(cfg.sendDefaultPii).toBe(false);
    // El free tier son 5k eventos/mes: las trazas van muestreadas.
    expect(cfg.tracesSampleRate).toBeLessThan(1);
  });

  it('con DSN los eventos de negocio van como breadcrumb, no como evento propio', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://clave@o0.ingest.sentry.io/1';
    const { initObservability } = await import('./sentry');
    const { track } = await import('./events');

    initObservability();
    // `cart_item_added`, no `cart.item_added`: todos los eventos de este módulo van
    // en snake_case (el punto es la convención del BACKEND). US-007 T4.3.
    track('cart_item_added', { slug: 'taco-fischer' });

    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'business',
        message: 'cart_item_added',
      }),
    );
    // Un breadcrumb NO consume cuota de eventos: si esto fuera captureMessage,
    // el free tier se agotaría en días.
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe('captureError', () => {
  it('reporta la excepción al SDK — antes era un no-op con llamadores reales', async () => {
    const { captureError } = await import('./sentry');
    const boom = new Error('falló la revalidación');

    captureError(boom);

    expect(captureException).toHaveBeenCalledWith(boom);
  });
});
