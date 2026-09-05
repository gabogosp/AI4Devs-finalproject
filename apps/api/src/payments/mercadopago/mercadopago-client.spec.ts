import { ConfigService } from '@nestjs/config';
import { MercadoPagoPermanentError, MercadoPagoTransientError } from './backoff';
import { MercadoPagoClient } from './mercadopago-client';

/**
 * T3.2 — el adapter REST. `fetch` mockeado: lo que se prueba es el mapeo de
 * la respuesta, la clasificación transitorio/permanente y el breaker — no
 * que MercadoPago funcione.
 */
const TOKEN = 'TOKEN-SECRETO-DE-TEST-NO-REAL';

const config = new ConfigService({
  MP_ACCESS_TOKEN: TOKEN,
  MP_HTTP_TIMEOUT_MS: 4_000,
  MP_MAX_RETRIES: 0,
}) as ConfigService;

/** Cliente con las costuras de tiempo neutralizadas y breaker de umbral bajo para probarlo rápido. */
const cliente = (opts: { maxRetries?: number; breakerThreshold?: number; breakerCooldownMs?: number } = {}) =>
  new MercadoPagoClient(config, 'https://stub.test', {
    sleep: async () => undefined,
    now: () => 0,
    maxRetries: opts.maxRetries ?? 0,
    breakerThreshold: opts.breakerThreshold ?? 3,
    breakerCooldownMs: opts.breakerCooldownMs ?? 60_000,
  });

function respuesta(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: { get: (h: string) => init.headers?.[h.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

let fetchSpy: jest.SpyInstance;
const mockFetch = (r: Response | Promise<Response>) => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(r));
};

afterEach(() => {
  fetchSpy?.mockRestore();
});

describe('MercadoPagoClient.getPayment', () => {
  it('mapea transaction_amount (decimal) a amountArsCents (entero)', async () => {
    mockFetch(
      respuesta({ id: 'mp-1', status: 'approved', transaction_amount: 1250.5 }),
    );

    const pago = await cliente().getPayment('mp-1');

    expect(pago.amountArsCents).toBe(125_050);
    expect(pago.status).toBe('approved');
  });

  it('nunca manda el token en la URL, sólo en el header Authorization', async () => {
    mockFetch(respuesta({ id: 'mp-1', status: 'approved', transaction_amount: 100 }));

    await cliente().getPayment('mp-1');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('un 5xx dispara reintento (con maxRetries > 0)', async () => {
    let llamadas = 0;
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      llamadas += 1;
      return Promise.resolve(
        llamadas === 1
          ? respuesta({}, { status: 500 })
          : respuesta({ id: 'mp-1', status: 'approved', transaction_amount: 100 }),
      );
    });

    const pago = await cliente({ maxRetries: 1 }).getPayment('mp-1');

    expect(llamadas).toBe(2);
    expect(pago.status).toBe('approved');
  });

  it('un 400 NO se reintenta y lanza MercadoPagoPermanentError', async () => {
    mockFetch(respuesta({}, { status: 400 }));

    await expect(cliente({ maxRetries: 2 }).getPayment('mp-1')).rejects.toBeInstanceOf(
      MercadoPagoPermanentError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('un timeout se traduce a MercadoPagoTransientError sin exponer el error crudo', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    await expect(cliente().getPayment('mp-1')).rejects.toBeInstanceOf(MercadoPagoTransientError);
  });

  it('ningún mensaje de error incluye el MP_ACCESS_TOKEN', async () => {
    mockFetch(respuesta({}, { status: 500 }));

    try {
      await cliente().getPayment('mp-1');
      fail('debía lanzar');
    } catch (error) {
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });
});

describe('MercadoPagoClient.searchByExternalReference', () => {
  it('mapea cada resultado de la búsqueda', async () => {
    mockFetch(
      respuesta({
        results: [
          { id: 'mp-1', status: 'approved', transaction_amount: 100 },
          { id: 'mp-2', status: 'rejected', transaction_amount: 50 },
        ],
      }),
    );

    const pagos = await cliente().searchByExternalReference('order-1');

    expect(pagos).toHaveLength(2);
    expect(pagos[0].amountArsCents).toBe(10_000);
    expect(pagos[1].status).toBe('rejected');
  });

  it('sin resultados, devuelve un array vacío', async () => {
    mockFetch(respuesta({ results: [] }));

    expect(await cliente().searchByExternalReference('order-1')).toEqual([]);
  });
});

describe('MercadoPagoClient.refund', () => {
  it('convierte amountArsCents a un monto ARS decimal en el body', async () => {
    mockFetch(respuesta({}));

    await cliente().refund('mp-1', 125_050);

    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ amount: 1250.5 });
  });

  it('sin amountArsCents, manda el refund sin body (reembolso total)', async () => {
    mockFetch(respuesta({}));

    await cliente().refund('mp-1');

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.body).toBeUndefined();
  });
});

describe('MercadoPagoClient — breaker', () => {
  it('tras N fallos consecutivos, la siguiente llamada falla rápido sin tocar fetch', async () => {
    mockFetch(respuesta({}, { status: 500 }));
    const c = cliente({ breakerThreshold: 3 });

    await c.getPayment('mp-1').catch(() => undefined);
    await c.getPayment('mp-1').catch(() => undefined);
    await c.getPayment('mp-1').catch(() => undefined);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    await expect(c.getPayment('mp-1')).rejects.toBeInstanceOf(MercadoPagoTransientError);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // breaker abierto: NO llamó a fetch de nuevo
  });

  it('un éxito reinicia el contador de fallos consecutivos', async () => {
    const secuencia = [500, 500, 200, 500]; // fallo, fallo, éxito (reinicia), fallo
    let llamada = 0;
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const status = secuencia[llamada];
      llamada += 1;
      return Promise.resolve(
        status === 200
          ? respuesta({ id: 'mp-1', status: 'approved', transaction_amount: 100 })
          : respuesta({}, { status }),
      );
    });
    const c = cliente({ breakerThreshold: 3 });

    await c.getPayment('mp-1').catch(() => undefined); // fallo 1
    await c.getPayment('mp-1').catch(() => undefined); // fallo 2
    await c.getPayment('mp-1'); // éxito — reinicia el contador
    await c.getPayment('mp-1').catch(() => undefined); // fallo 1 de nuevo, no 3°

    expect(fetchSpy).toHaveBeenCalledTimes(4); // nunca abrió el breaker
  });
});
