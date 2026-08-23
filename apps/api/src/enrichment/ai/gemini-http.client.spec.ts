import { ConfigService } from '@nestjs/config';
import {
  AiPermanentError,
  AiTransientError,
} from '../../common/errors/enrichment-errors';
import {
  EMBEDDING_DIMS,
  ENRICH_PROMPT_V1,
  GeminiHttpClient,
} from './gemini-http.client';

/**
 * T1.2 — el adapter REST. `fetch` mockeado: lo que se prueba es **la validación de la
 * respuesta y el manejo del secreto**, no que Gemini funcione.
 *
 * El caso que da sentido a todo el archivo: un vector de 512 dimensiones o con `NaN`
 * llegaría a la base, entraría al índice HNSW y la búsqueda semántica lo devolvería como
 * resultado. Rechazarlo acá es más barato que descubrirlo en la demo.
 */
/**
 * Clave de test. NO imita el prefijo `AIza` de una clave real de Google: el gate de secretos
 * (`git grep -nE "AIza[0-9A-Za-z_-]{20,}"`) escanea todo el árbol, y una clave de test que lo
 * imite lo deja siempre en rojo. Una red que siempre falla se ignora.
 */
const CLAVE = 'CLAVE-SECRETA-DE-TEST-NO-REAL';

const config = new ConfigService({
  GEMINI_API_KEY: CLAVE,
  GEMINI_EMBED_MODEL: 'text-embedding-004',
  GEMINI_ENRICH_MODEL: 'gemini-1.5-flash',
  GEMINI_EMBED_TIMEOUT_MS: 10_000,
  GEMINI_ENRICH_TIMEOUT_MS: 20_000,
  ENRICHMENT_MAX_ENRICHED_CHARS: 1_200,
  // EXPLÍCITO y no heredado del default: los tests de espaciado de abajo calculan
  // `60_000 / RPM`, y con el valor por defecto quedaban a merced de una decisión de otra
  // lane — US-004 bajó el default de 15 a 5 al repartir la cuota con la búsqueda, y estos
  // dos tests se pusieron rojos sin que el adapter hubiera cambiado. El presupuesto que el
  // test mide tiene que ser el que el test declara.
  GEMINI_MAX_RPM: 15,
}) as ConfigService;

/**
 * Cliente con las **costuras de tiempo neutralizadas**.
 *
 * El adapter reintenta los transitorios y espacia las salidas a `60_000 / GEMINI_MAX_RPM`
 * (T1.3, cableado en T6.3). Sin inyectar el `sleep`, cada test de un 429 dormiría de verdad —
 * uno tardó 63 s antes de esto. `maxRetries: 0` es el default de este helper porque la mayoría
 * de los tests verifican la CLASIFICACIÓN del fallo, no la política de reintento; los que
 * prueban el reintento piden los suyos explícitamente.
 */
const cliente = (maxRetries = 0) =>
  new GeminiHttpClient(config, 'https://stub.test', {
    sleep: async () => undefined,
    now: () => 0,
    maxRetries,
  });

const vectorOk = () => Array.from({ length: EMBEDDING_DIMS }, (_, i) => (i + 1) / 1000);

/** Respuesta `fetch` mínima y tipada como la usa el adapter. */
function respuesta(
  body: unknown,
  init: { status?: number; headers?: Record<string, string>; invalidJson?: boolean } = {},
): Response {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: { get: (h: string) => init.headers?.[h.toLowerCase()] ?? null },
    json: init.invalidJson
      ? () => Promise.reject(new Error('Unexpected token'))
      : () => Promise.resolve(body),
  } as unknown as Response;
}

let fetchSpy: jest.SpyInstance;
const mockFetch = (r: Response | Promise<Response>) => {
  fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(r));
};

/** Respuestas en secuencia: la primera llamada recibe la primera, y así. */
const mockFetchSecuencia = (rs: Response[]) => {
  let i = 0;
  fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(rs[Math.min(i++, rs.length - 1)]));
};

afterEach(() => {
  fetchSpy?.mockRestore();
});

describe('GeminiHttpClient.embed — validación del vector', () => {
  it('768 dimensiones finitas y con norma > 0 ⇒ devuelve el vector', async () => {
    mockFetch(respuesta({ embedding: { values: vectorOk() } }));

    const v = await cliente().embed('taco fischer 8mm');

    expect(v).toHaveLength(EMBEDDING_DIMS);
    expect(v[0]).toBeCloseTo(0.001);
  });

  it('512 dimensiones ⇒ AiPermanentError (el esquema exige 768)', async () => {
    mockFetch(respuesta({ embedding: { values: new Array(512).fill(0.5) } }));

    await expect(cliente().embed('x')).rejects.toBeInstanceOf(AiPermanentError);
    await expect(cliente().embed('x')).rejects.toThrow(/512 dimensiones/);
  });

  it('vector con NaN ⇒ AiPermanentError', async () => {
    const conNaN = vectorOk();
    conNaN[7] = Number.NaN;
    mockFetch(respuesta({ embedding: { values: conNaN } }));

    await expect(cliente().embed('x')).rejects.toThrow(/no finitos/);
  });

  it('vector de norma 0 ⇒ AiPermanentError (rompería el orden del kNN)', async () => {
    mockFetch(
      respuesta({ embedding: { values: new Array(EMBEDDING_DIMS).fill(0) } }),
    );

    await expect(cliente().embed('x')).rejects.toThrow(/norma 0/);
  });

  it('vector vacío ⇒ AiPermanentError', async () => {
    mockFetch(respuesta({ embedding: { values: [] } }));

    await expect(cliente().embed('x')).rejects.toBeInstanceOf(AiPermanentError);
  });

  it('JSON con otra forma ({"foo":1}) ⇒ AiPermanentError', async () => {
    mockFetch(respuesta({ foo: 1 }));

    await expect(cliente().embed('x')).rejects.toThrow(/no trae un vector/);
  });

  it('respuesta que no es JSON ⇒ AiPermanentError', async () => {
    mockFetch(respuesta(null, { invalidJson: true }));

    await expect(cliente().embed('x')).rejects.toThrow(/no es JSON/);
  });
});

describe('GeminiHttpClient — clasificación de fallos del proveedor', () => {
  it('429 con Retry-After: 30 ⇒ AiTransientError con retryAfterSeconds 30', async () => {
    mockFetch(respuesta({}, { status: 429, headers: { 'retry-after': '30' } }));

    const error = await cliente()
      .embed('x')
      .catch((e: AiTransientError) => e);

    expect(error).toBeInstanceOf(AiTransientError);
    expect((error as AiTransientError).retryAfterSeconds).toBe(30);
  });

  it('429 sin Retry-After ⇒ AiTransientError sin retryAfterSeconds', async () => {
    mockFetch(respuesta({}, { status: 429 }));

    const error = await cliente()
      .embed('x')
      .catch((e: AiTransientError) => e);

    expect((error as AiTransientError).retryAfterSeconds).toBeUndefined();
  });

  it('503 ⇒ AiTransientError', async () => {
    mockFetch(respuesta({}, { status: 503 }));

    await expect(cliente().embed('x')).rejects.toBeInstanceOf(AiTransientError);
  });

  it('400 ⇒ AiPermanentError (reintentarlo sólo quema cuota)', async () => {
    mockFetch(respuesta({}, { status: 400 }));

    await expect(cliente().embed('x')).rejects.toBeInstanceOf(AiPermanentError);
  });

  it('AbortError del timeout ⇒ AiTransientError que nombra el timeout', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.reject(abort));

    await expect(cliente().embed('x')).rejects.toThrow(/no respondió en 10000 ms/);
  });

  it('fallo de red ⇒ AiTransientError', async () => {
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.reject(new Error('ENOTFOUND')));

    await expect(cliente().embed('x')).rejects.toBeInstanceOf(AiTransientError);
  });
});

describe('GeminiHttpClient — el secreto no se filtra (AC-9)', () => {
  it('la clave va en el header x-goog-api-key y NO en la URL', async () => {
    mockFetch(respuesta({ embedding: { values: vectorOk() } }));

    await cliente().embed('x');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('key=');
    expect(url).not.toContain(CLAVE);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(CLAVE);
  });

  it('ningún error de ningún caso contiene la clave', async () => {
    const casos: Array<() => void> = [
      () => mockFetch(respuesta({ embedding: { values: new Array(512).fill(1) } })),
      () => mockFetch(respuesta({}, { status: 429 })),
      () => mockFetch(respuesta({}, { status: 400 })),
      () => mockFetch(respuesta({}, { status: 503 })),
      () => mockFetch(respuesta(null, { invalidJson: true })),
    ];

    for (const preparar of casos) {
      fetchSpy?.mockRestore();
      preparar();
      const error = await cliente()
        .embed('x')
        .catch((e: unknown) => e);
      expect(String(error)).not.toContain(CLAVE);
      expect(JSON.stringify(error instanceof Error ? error.message : error)).not.toContain(
        CLAVE,
      );
    }
  });
});

describe('GeminiHttpClient.enrich — texto, tope y prompt', () => {
  const textoDe = (t: string) =>
    respuesta({ candidates: [{ content: { parts: [{ text: t }] } }] });

  it('devuelve el texto del proveedor, sin espacios de sobra', async () => {
    mockFetch(textoDe('  Tarugo de nylon para pared de material.  '));

    await expect(
      cliente().enrich({ name: 'Taco', categoryName: 'Fijaciones', baseText: null }),
    ).resolves.toBe('Tarugo de nylon para pared de material.');
  });

  it('respuesta vacía ⇒ AiPermanentError', async () => {
    mockFetch(textoDe('   '));

    await expect(
      cliente().enrich({ name: 'x', categoryName: 'y', baseText: null }),
    ).rejects.toBeInstanceOf(AiPermanentError);
  });

  it('candidates con otra forma ⇒ AiPermanentError', async () => {
    mockFetch(respuesta({ candidates: [] }));

    await expect(
      cliente().enrich({ name: 'x', categoryName: 'y', baseText: null }),
    ).rejects.toThrow(/vacía o con otra forma/);
  });

  it('recorta al tope de caracteres sin partir una palabra', async () => {
    const original =
      'Tarugo de nylon para pared de material macizo, con tornillo incluido y punta guía.';
    const cortoConfig = new ConfigService({
      GEMINI_API_KEY: CLAVE,
      GEMINI_ENRICH_MODEL: 'gemini-1.5-flash',
      GEMINI_ENRICH_TIMEOUT_MS: 20_000,
      ENRICHMENT_MAX_ENRICHED_CHARS: 40,
    }) as ConfigService;
    mockFetch(textoDe(original));

    const texto = await new GeminiHttpClient(cortoConfig, 'https://stub.test', {
      sleep: async () => undefined,
      now: () => 0,
      maxRetries: 0,
    }).enrich({
      name: 'Taco',
      categoryName: 'Fijaciones',
      baseText: null,
    });

    expect(texto.length).toBeLessThanOrEqual(41); // 40 + la elipsis
    // «Sin partir una palabra» = lo que quedó es un prefijo del original que termina
    // justo donde el original tenía un espacio. Un corte a mitad de palabra dejaría
    // al original continuando con una letra.
    expect(texto.endsWith('…')).toBe(true);
    const conservado = texto.slice(0, -1);
    expect(original.startsWith(conservado)).toBe(true);
    expect(original[conservado.length]).toBe(' ');
  });

  it('el prompt manda el rubro y el texto base al proveedor (D3)', async () => {
    mockFetch(textoDe('ok'));

    await cliente().enrich({
      name: 'Mecha widia 8mm',
      categoryName: 'Mechas y brocas',
      baseText: 'mecha 8',
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain('Mechas y brocas');
    expect(body).toContain('Mecha widia 8mm');
    expect(body).toContain('mecha 8');
  });

  it('el prompt versionado prohíbe inventar especificaciones', () => {
    // Es la regla que evita que el catálogo prometa lo que el producto no declara.
    expect(ENRICH_PROMPT_V1).toMatch(/inventar especificaciones/i);
    expect(ENRICH_PROMPT_V1).toMatch(/sinónimos/i);
    expect(ENRICH_PROMPT_V1).toMatch(/rioplatense/i);
  });
});

/**
 * El cableado de T1.3 dentro del adapter (cerrado en T6.3).
 *
 * Las primitivas —`withRetry` y `RateLimiter`— tenían sus propios tests desde T1.3, pero el
 * adapter **no las usaba**: se construyeron y quedaron desconectadas. En producción eso
 * significaba ningún reintento inmediato y, peor, **ningún tope de RPM**: una corrida con
 * concurrencia 2 dispara tan rápido como la red permita, el free tier de 15 RPM contesta 429 en
 * masa y el breaker abre a los pocos productos. La primera corrida del catálogo real habría
 * fallado casi entera. Estos tests son la evidencia de que ahora están conectadas.
 */
describe('GeminiHttpClient — reintento y tope de RPM cableados', () => {
  afterEach(() => fetchSpy?.mockRestore());

  it('un 429 seguido de éxito ⇒ el adapter reintenta y devuelve el vector', async () => {
    mockFetchSecuencia([
      respuesta({}, { status: 429, headers: { 'retry-after': '1' } }),
      respuesta({ embedding: { values: vectorOk() } }),
    ]);

    const v = await cliente(3).embed('taco fischer');

    expect(v).toHaveLength(EMBEDDING_DIMS);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('un 5xx transitorio se reintenta hasta el tope y después propaga', async () => {
    mockFetch(respuesta({}, { status: 503 }));

    await expect(cliente(2).embed('x')).rejects.toThrow(AiTransientError);

    // 1 intento inicial + 2 reintentos: ni uno más, o se quema cuota contra un proveedor caído.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('un 400 permanente NO se reintenta: insistir no lo arregla', async () => {
    mockFetch(respuesta({}, { status: 400 }));

    await expect(cliente(3).embed('x')).rejects.toThrow(AiPermanentError);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('respeta el intervalo mínimo entre llamadas (60_000 / GEMINI_MAX_RPM)', async () => {
    // Con 15 RPM el intervalo es 4 s. Se mide sobre el `sleep` inyectado, así que el test no
    // espera de verdad: lo que se verifica es que el adapter PIDE la espera.
    mockFetch(respuesta({ embedding: { values: vectorOk() } }));
    const esperas: number[] = [];
    let reloj = 0;
    const clienteConReloj = new GeminiHttpClient(config, 'https://stub.test', {
      sleep: async (ms) => {
        esperas.push(ms);
        reloj += ms;
      },
      now: () => reloj,
      maxRetries: 0,
    });

    await clienteConReloj.embed('uno');
    await clienteConReloj.embed('dos');
    await clienteConReloj.embed('tres');

    // La primera sale sin esperar; las dos siguientes esperan su hueco de 4 s.
    expect(esperas).toEqual([4_000, 4_000]);
  });

  it('las dos superficies COMPARTEN la cuota: enrich y embed usan el mismo limitador', async () => {
    // La cuota del free tier es por clave, no por método. Un limitador por método permitiría
    // el doble del tope real y el 429 llegaría igual.
    const esperas: number[] = [];
    let reloj = 0;
    mockFetch(
      respuesta({
        embedding: { values: vectorOk() },
        candidates: [{ content: { parts: [{ text: 'Texto enriquecido de prueba.' }] } }],
      }),
    );
    const c = new GeminiHttpClient(config, 'https://stub.test', {
      sleep: async (ms) => {
        esperas.push(ms);
        reloj += ms;
      },
      now: () => reloj,
      maxRetries: 0,
    });

    await c.embed('uno');
    await c.enrich({ name: 'Taco', categoryName: 'Fijaciones', baseText: null });

    expect(esperas).toEqual([4_000]);
  });
});
