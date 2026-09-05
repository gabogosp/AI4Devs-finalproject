import { validateEnv } from './env.validation';

describe('validateEnv (config fail-fast §7)', () => {
  const base = {
    DATABASE_URL: 'postgresql://dsm:dsm@localhost:55432/dsm?schema=public',
    JWT_SECRET: 'test-secret',
  };

  it('acepta env válido y castea PORT a número', () => {
    const env = validateEnv({ ...base, PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.ADMIN_AUTH_ENABLED).toBe('true');
  });

  it('lanza si falta JWT_SECRET', () => {
    expect(() => validateEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(
      /Config de entorno inválida/,
    );
  });

  it('lanza si falta DATABASE_URL', () => {
    expect(() => validateEnv({ JWT_SECRET: 's' })).toThrow(
      /Config de entorno inválida/,
    );
  });

  it('lanza si PORT no es numérico', () => {
    expect(() => validateEnv({ ...base, PORT: 'no-num' })).toThrow();
  });
});

describe('Auth de clientes (US-014 T0.3) — defaults y fail-fast', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'test-secret',
  };

  it('sin las variables, aplica los defaults seguros exactos', () => {
    const env = validateEnv({ ...base });
    expect(env.AUTH_ACCESS_TTL_MIN).toBe(15);
    expect(env.AUTH_REFRESH_TTL_DAYS).toBe(30);
    expect(env.AUTH_COOKIE_SECURE).toBe('true');
    expect(env.AUTH_LOGIN_MAX_FAILURES).toBe(5);
    expect(env.AUTH_LOCKOUT_BASE_MIN).toBe(15);
    expect(env.AUTH_LOCKOUT_MAX_MIN).toBe(60);
    expect(env.PASSWORD_RESET_TTL_MIN).toBe(60);
    expect(env.PASSWORD_RESET_MAX_PER_HOUR).toBe(3);
    expect(env.BCRYPT_COST).toBe(12);
  });

  it('BCRYPT_COST=abc hace fallar el arranque, no cae al default', () => {
    expect(() => validateEnv({ ...base, BCRYPT_COST: 'abc' })).toThrow(
      /fail-fast/,
    );
  });

  it('AUTH_ACCESS_TTL_MIN=-1 hace fallar el arranque', () => {
    expect(() => validateEnv({ ...base, AUTH_ACCESS_TTL_MIN: '-1' })).toThrow(
      /fail-fast/,
    );
  });

  it('AUTH_COOKIE_SECURE sólo acepta true|false', () => {
    expect(() => validateEnv({ ...base, AUTH_COOKIE_SECURE: 'yes' })).toThrow(
      /fail-fast/,
    );
  });
});

describe('Carrito del invitado (US-007 T0.2) — defaults y fail-fast', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'test-secret',
  };

  it('sin las variables, aplica los 6 defaults seguros exactos', () => {
    const env = validateEnv({ ...base });
    // Literal a propósito: si alguien "recupera" los 30 días de la recomendación
    // original del diseño, este test falla. La decisión del PO fue 7 (OQ-BE-1).
    expect(env.CART_TTL_DAYS).toBe(7);
    expect(env.CART_MAX_ITEMS).toBe(50);
    expect(env.CART_MAX_QTY_PER_LINE).toBe(99);
    expect(env.CART_RATE_LIMIT_TTL_MS).toBe(60_000);
    expect(env.CART_RATE_LIMIT_MAX).toBe(120);
    expect(env.CART_WRITE_RATE_LIMIT_MAX).toBe(30);
  });

  it('el presupuesto de escritura es más estricto que el de lectura', () => {
    const env = validateEnv({ ...base });
    expect(env.CART_WRITE_RATE_LIMIT_MAX).toBeLessThan(env.CART_RATE_LIMIT_MAX);
  });

  it('CART_TTL_DAYS=abc hace fallar el arranque, no cae al default', () => {
    expect(() => validateEnv({ ...base, CART_TTL_DAYS: 'abc' })).toThrow(
      /fail-fast/,
    );
  });

  it('CART_MAX_ITEMS=-1 hace fallar el arranque', () => {
    expect(() => validateEnv({ ...base, CART_MAX_ITEMS: '-1' })).toThrow(
      /fail-fast/,
    );
  });

  it('CART_MAX_QTY_PER_LINE=0 hace fallar el arranque', () => {
    expect(() => validateEnv({ ...base, CART_MAX_QTY_PER_LINE: '0' })).toThrow(
      /fail-fast/,
    );
  });

  it('la cookie del carrito NO agrega una segunda variable de Secure', () => {
    // Reusa `AUTH_COOKIE_SECURE`: dos flags para el mismo concepto terminan con
    // una superficie endurecida y la otra no.
    const env = validateEnv({ ...base });
    expect(env).not.toHaveProperty('CART_COOKIE_SECURE');
    expect(env.AUTH_COOKIE_SECURE).toBe('true');
  });
});

describe('Checkout guest (US-008 T0.2) — defaults y fail-fast', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'test-secret',
  };

  it('sin las variables, aplica los 3 defaults seguros literales', () => {
    const env = validateEnv({ ...base });
    expect(env.CHECKOUT_RATE_LIMIT_TTL_MS).toBe(600_000);
    expect(env.CHECKOUT_RATE_LIMIT_MAX).toBe(10);
    expect(env.LEGAL_TERMS_VERSION).toBe('2026-06-15');
  });

  it('CHECKOUT_RATE_LIMIT_MAX=-1 hace fallar el arranque', () => {
    expect(() =>
      validateEnv({ ...base, CHECKOUT_RATE_LIMIT_MAX: '-1' }),
    ).toThrow(/fail-fast/);
  });

  it('CHECKOUT_RATE_LIMIT_TTL_MS=abc hace fallar el arranque', () => {
    expect(() =>
      validateEnv({ ...base, CHECKOUT_RATE_LIMIT_TTL_MS: 'abc' }),
    ).toThrow(/fail-fast/);
  });

  it('LEGAL_TERMS_VERSION vacío hace fallar el arranque, no cae al default', () => {
    // Contrato con el frontend (versionContract.test.ts, US-017 T4.3): un
    // default silencioso ante un valor vacío dejaría la orden registrando
    // una versión que nadie declaró.
    expect(() => validateEnv({ ...base, LEGAL_TERMS_VERSION: '' })).toThrow(
      /fail-fast/,
    );
  });
});

describe('Enriquecimiento IA + embeddings (US-005 T0.3) — defaults y fail-fast', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'test-secret',
  };

  it('sin ninguna de las 16 variables, aplica los defaults exactos', () => {
    const env = validateEnv({ ...base });

    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GEMINI_ENRICH_MODEL).toBe('gemini-1.5-flash');
    expect(env.GEMINI_EMBED_MODEL).toBe('text-embedding-004');
    expect(env.GEMINI_ENRICH_TIMEOUT_MS).toBe(20_000);
    expect(env.GEMINI_EMBED_TIMEOUT_MS).toBe(10_000);
    // 5 y no 15: los 15 RPM del free tier se REPARTEN con la búsqueda (US-004), y el
    // default codifica el estado estable (5 lote / 10 interactivo). La primera corrida del
    // catálogo se lleva la cuota entera, pero eso es un override del runbook §3.6 y no un
    // default — un default que codifica una migración de una sola vez queda mintiendo para
    // siempre.
    expect(env.GEMINI_MAX_RPM).toBe(5);
    expect(env.ENRICHMENT_ENABLED).toBe('true');
    expect(env.ENRICHMENT_BATCH_SIZE).toBe(25);
    expect(env.ENRICHMENT_CONCURRENCY).toBe(2);
    expect(env.ENRICHMENT_MAX_ATTEMPTS).toBe(5);
    expect(env.ENRICHMENT_LEASE_MS).toBe(120_000);
    expect(env.ENRICHMENT_COOLDOWN_MS).toBe(300_000);
    expect(env.ENRICHMENT_FAILURE_THRESHOLD).toBe(5);
    expect(env.ENRICHMENT_MAX_ENRICHED_CHARS).toBe(1_200);
    expect(env.ENRICHMENT_RATE_LIMIT_TTL_MS).toBe(60_000);
    expect(env.ENRICHMENT_RATE_LIMIT_MAX).toBe(6);
  });

  it('en DESARROLLO sin GEMINI_API_KEY parsea OK (el runner queda disabled)', () => {
    // D6: sin clave la feature no funciona, pero el arranque local no se rompe —
    // el catálogo sigue navegable por categoría (AC-5).
    const env = validateEnv({ ...base, NODE_ENV: 'development' });
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it('en PRODUCCIÓN sin GEMINI_API_KEY lanza, y el mensaje nombra la variable', () => {
    // Una feature de IA que arranca muda en producción no se descubre hasta la demo.
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        RESEND_API_KEY: 'k',
        PASSWORD_RESET_FROM: 'a@b.com',
        PASSWORD_RESET_URL_BASE: 'https://dsm.test/reset',
      }),
    ).toThrow(/GEMINI_API_KEY/);
  });

  it('en PRODUCCIÓN con GEMINI_API_KEY arranca', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      GEMINI_API_KEY: 'clave-real',
      RESEND_API_KEY: 'k',
      PASSWORD_RESET_FROM: 'a@b.com',
      PASSWORD_RESET_URL_BASE: 'https://dsm.test/reset',
      MP_ACCESS_TOKEN: 'mp-clave-real',
      MP_WEBHOOK_SECRET: 'mp-secreto-real',
    });
    expect(env.GEMINI_API_KEY).toBe('clave-real');
  });

  it('ENRICHMENT_CONCURRENCY=0 hace fallar el arranque, no cae al default', () => {
    expect(() =>
      validateEnv({ ...base, ENRICHMENT_CONCURRENCY: '0' }),
    ).toThrow(/fail-fast/);
  });

  it('GEMINI_MAX_RPM=abc hace fallar el arranque', () => {
    expect(() => validateEnv({ ...base, GEMINI_MAX_RPM: 'abc' })).toThrow(
      /fail-fast/,
    );
  });

  it('los topes de cuota se respetan: batch > 200 y concurrencia > 8 fallan', () => {
    // Los máximos no son decorativos: protegen la cuota del proveedor y el
    // request path (una corrida gigante compite con el tráfico real).
    expect(() =>
      validateEnv({ ...base, ENRICHMENT_BATCH_SIZE: '201' }),
    ).toThrow(/fail-fast/);
    expect(() =>
      validateEnv({ ...base, ENRICHMENT_CONCURRENCY: '9' }),
    ).toThrow(/fail-fast/);
  });

  it('ENRICHMENT_ENABLED sólo acepta true|false', () => {
    expect(() =>
      validateEnv({ ...base, ENRICHMENT_ENABLED: 'yes' }),
    ).toThrow(/fail-fast/);
  });

  it('una clave vacía NO cuenta como clave presente', () => {
    // `GEMINI_API_KEY=` en un .env es el error de configuración más común, y
    // `.min(1)` es lo que evita que el adapter arranque con una cadena vacía.
    expect(() => validateEnv({ ...base, GEMINI_API_KEY: '' })).toThrow(
      /fail-fast/,
    );
  });
});

describe('Import masivo de inventario (US-006 T0.3) — defaults y fail-fast', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'test-secret',
  };

  it('sin las variables, aplica los 9 defaults seguros exactos', () => {
    const env = validateEnv({ ...base });
    // Literales a propósito: los tres primeros son la decisión del PO en OQ-BE-3
    // (tope AJUSTADO, no el holgado del diseño). Si alguien los "recupera" a los
    // valores holgados, este test falla y la conversación vuelve al PO.
    expect(env.IMPORT_MAX_FILE_BYTES).toBe(4_194_304); // 4 MiB
    expect(env.IMPORT_MAX_ROWS).toBe(5_000);
    expect(env.IMPORT_MAX_UNCOMPRESSED_BYTES).toBe(33_554_432); // 32 MiB
    expect(env.IMPORT_BATCH_SIZE).toBe(200);
    expect(env.IMPORT_MAX_REPORT_ROWS).toBe(1_000);
    expect(env.IMPORT_JOB_STALE_MS).toBe(120_000);
    expect(env.IMPORT_RETENTION_DAYS).toBe(90);
    expect(env.IMPORT_RATE_LIMIT_MAX).toBe(3);
    expect(env.IMPORT_RATE_LIMIT_TTL_MS).toBe(3_600_000);
  });

  it('IMPORT_MAX_ROWS=abc hace fallar el arranque, no cae al default', () => {
    // Un cap que se degrada a su default por un typo es un cap que no existe.
    expect(() => validateEnv({ ...base, IMPORT_MAX_ROWS: 'abc' })).toThrow(
      /fail-fast/,
    );
  });

  it('IMPORT_BATCH_SIZE=0 hace fallar el arranque', () => {
    // Un lote de 0 filas es un runner que nunca avanza: mejor no arrancar.
    expect(() => validateEnv({ ...base, IMPORT_BATCH_SIZE: '0' })).toThrow(
      /fail-fast/,
    );
  });

  it('IMPORT_MAX_FILE_BYTES=-1 hace fallar el arranque', () => {
    expect(() =>
      validateEnv({ ...base, IMPORT_MAX_FILE_BYTES: '-1' }),
    ).toThrow(/fail-fast/);
  });

  it('castea los valores provistos a número, sin dejarlos como string', () => {
    const env = validateEnv({
      ...base,
      IMPORT_MAX_ROWS: '10000',
      IMPORT_RETENTION_DAYS: '30',
    });
    expect(env.IMPORT_MAX_ROWS).toBe(10_000);
    expect(env.IMPORT_RETENTION_DAYS).toBe(30);
  });

  it('el presupuesto del POST de import es más estricto que el del carrito', () => {
    // El POST abre un trabajo que escribe miles de filas; una lectura del
    // carrito no. Si algún día se invierten, el import quedó mal presupuestado.
    const env = validateEnv({ ...base });
    expect(env.IMPORT_RATE_LIMIT_MAX).toBeLessThan(env.CART_RATE_LIMIT_MAX);
  });
});

/**
 * T0.2 — configuración de la búsqueda semántica (US-004).
 *
 * Los defaults van con **valor literal** a propósito: son decisiones del PO (OQ-BE-1 (b),
 * OQ-BE-2, OQ-BE-6) y no números de conveniencia. Si alguien los cambia sin discutirlo, un
 * test se pone rojo y aparece la conversación; con `expect.any(Number)` el cambio pasaría.
 */
describe('envSchema — búsqueda semántica (US-004)', () => {
  // El `base` del describe de arriba está en su scope; se repite el mínimo acá para que este
  // bloque sea independiente y se pueda leer sin scrollear 280 líneas.
  const base = {
    DATABASE_URL: 'postgresql://dsm:dsm@localhost:55432/dsm?schema=public',
    JWT_SECRET: 'test-secret',
  };

  it('sin las variables, los 13 defaults son los que fijó el PO', () => {
    const env = validateEnv({ ...base });

    expect(env.GEMINI_SEARCH_MAX_RPM).toBe(10);
    expect(env.GEMINI_SEARCH_TIMEOUT_MS).toBe(900);
    expect(env.SEARCH_MIN_SCORE).toBe(0.55);
    expect(env.SEARCH_MIN_LENGTH).toBe(2);
    expect(env.SEARCH_MAX_LENGTH).toBe(200);
    expect(env.SEARCH_LIMIT_DEFAULT).toBe(20);
    expect(env.SEARCH_LIMIT_MAX).toBe(50);
    // Vector puro con la perilla lista: el blend léxico se enciende sólo si la batería de
    // relevancia no llega al 70 %.
    expect(env.SEARCH_LEXICAL_WEIGHT).toBe(0);
    expect(env.SEARCH_HNSW_EF_SEARCH).toBe(64);
    // 24 h: el vector de una consulta es determinista, así que no hay nada que pueda quedar
    // viejo mientras no cambie el modelo. Un TTL corto sólo tiraría trabajo ya pagado.
    expect(env.SEARCH_CACHE_TTL_MS).toBe(86_400_000);
    expect(env.SEARCH_CACHE_MAX_ENTRIES).toBe(2_000);
    expect(env.SEARCH_RATE_LIMIT_TTL_MS).toBe(60_000);
    expect(env.SEARCH_RATE_LIMIT_MAX).toBe(20);
  });

  it('LA SUMA: las dos superficies no pueden pasarse de los 15 RPM del free tier', () => {
    // Es el invariante que impide que alguien suba un presupuesto sin bajar el otro. Sin
    // esto, el síntoma serían 429 del proveedor repartidos entre las dos superficies y
    // atribuidos a «Gemini anda mal» en vez de a una configuración imposible.
    expect(() =>
      validateEnv({ ...base, GEMINI_SEARCH_MAX_RPM: '10', GEMINI_MAX_RPM: '10' }),
    ).toThrow(/free tier/);

    // Y el reparto válido arranca sin chistar.
    const env = validateEnv({
      ...base,
      GEMINI_SEARCH_MAX_RPM: '10',
      GEMINI_MAX_RPM: '5',
    });
    expect(env.GEMINI_SEARCH_MAX_RPM + env.GEMINI_MAX_RPM).toBe(15);
  });

  it('la primera corrida es representable: toda la cuota al lote y búsqueda en 0', () => {
    // Es la decisión del PO (2026-08-23): la primera corrida se lleva el free tier entero
    // porque la búsqueda no sirve de nada hasta que existan los vectores. Con
    // GEMINI_SEARCH_MAX_RPM=0 la búsqueda queda degradada a full-text, que es un estado
    // PREVISTO. Si el mínimo fuera 1, esta configuración no existiría y el operador tendría
    // que elegir entre no arrancar o pasarse de la cuota.
    const env = validateEnv({
      ...base,
      GEMINI_MAX_RPM: '15',
      GEMINI_SEARCH_MAX_RPM: '0',
    });

    expect(env.GEMINI_MAX_RPM).toBe(15);
    expect(env.GEMINI_SEARCH_MAX_RPM).toBe(0);
  });

  it('el default del lote es el estado ESTABLE, no el de la primera corrida', () => {
    // 5 y no 15: un default que codifica una migración de una sola vez queda mintiendo para
    // siempre. La excepción vive en el runbook, no en el esquema.
    const env = validateEnv({ ...base });
    expect(env.GEMINI_MAX_RPM).toBe(5);
    expect(env.GEMINI_SEARCH_MAX_RPM).toBeGreaterThan(env.GEMINI_MAX_RPM);
  });

  it('un score fuera de 0..1 hace fallar el arranque', () => {
    // `SEARCH_MIN_SCORE` se compara contra `1 - distancia_cosine`, que vive en [0,1]. Un 1.5
    // haría que NADA supere el umbral: la búsqueda devolvería `confidence: none` siempre, y
    // el síntoma sería «la IA no encuentra nada» sin un error a la vista.
    expect(() => validateEnv({ ...base, SEARCH_MIN_SCORE: '1.5' })).toThrow();
    expect(() => validateEnv({ ...base, SEARCH_MIN_SCORE: '-0.1' })).toThrow();
  });

  it('un peso léxico fuera de 0..1 hace fallar el arranque', () => {
    expect(() => validateEnv({ ...base, SEARCH_LEXICAL_WEIGHT: '-1' })).toThrow();
    expect(() => validateEnv({ ...base, SEARCH_LEXICAL_WEIGHT: '2' })).toThrow();
  });

  it('un límite no numérico hace fallar el arranque, no cae al default', () => {
    // Un cap que se degrada a su default por un typo es un cap que no existe.
    expect(() => validateEnv({ ...base, SEARCH_LIMIT_MAX: 'abc' })).toThrow();
    expect(() => validateEnv({ ...base, GEMINI_SEARCH_TIMEOUT_MS: 'medio-segundo' })).toThrow();
  });

  it('el presupuesto de la búsqueda es más chico que el del storefront', () => {
    // La búsqueda cuesta una llamada paga; navegar categorías no. Si algún día se invierten,
    // alguien presupuestó mal la superficie que gasta dinero.
    const env = validateEnv({ ...base });
    expect(env.SEARCH_RATE_LIMIT_MAX).toBeLessThan(env.STOREFRONT_RATE_LIMIT_MAX);
  });
});

describe('MercadoPago (US-010 T4.2) — defaults y fail-fast', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'test-secret',
  };

  it('sin ninguna de las variables, aplica los defaults exactos', () => {
    const env = validateEnv({ ...base });

    expect(env.MP_ACCESS_TOKEN).toBeUndefined();
    expect(env.MP_WEBHOOK_SECRET).toBeUndefined();
    expect(env.MP_HTTP_TIMEOUT_MS).toBe(4_000);
    expect(env.MP_WEBHOOK_TOLERANCE_SEC).toBe(300);
    expect(env.MP_MAX_RETRIES).toBe(2);
  });

  it('en DESARROLLO sin MP_ACCESS_TOKEN/MP_WEBHOOK_SECRET parsea OK', () => {
    const env = validateEnv({ ...base, NODE_ENV: 'development' });
    expect(env.MP_ACCESS_TOKEN).toBeUndefined();
  });

  it('en PRODUCCIÓN sin MP_ACCESS_TOKEN lanza, y el mensaje nombra la variable', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        RESEND_API_KEY: 'k',
        PASSWORD_RESET_FROM: 'a@b.com',
        PASSWORD_RESET_URL_BASE: 'https://dsm.test/reset',
        MP_WEBHOOK_SECRET: 'secreto',
      }),
    ).toThrow(/MP_ACCESS_TOKEN/);
  });

  it('en PRODUCCIÓN sin MP_WEBHOOK_SECRET lanza, y el mensaje nombra la variable', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        RESEND_API_KEY: 'k',
        PASSWORD_RESET_FROM: 'a@b.com',
        PASSWORD_RESET_URL_BASE: 'https://dsm.test/reset',
        MP_ACCESS_TOKEN: 'token',
      }),
    ).toThrow(/MP_WEBHOOK_SECRET/);
  });

  it('en PRODUCCIÓN con las dos presentes, arranca', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      RESEND_API_KEY: 'k',
      PASSWORD_RESET_FROM: 'a@b.com',
      PASSWORD_RESET_URL_BASE: 'https://dsm.test/reset',
      GEMINI_API_KEY: 'g_x',
      MP_ACCESS_TOKEN: 'token',
      MP_WEBHOOK_SECRET: 'secreto',
    });
    expect(env.MP_ACCESS_TOKEN).toBe('token');
  });

  it('MP_HTTP_TIMEOUT_MS no numérico hace fallar el arranque', () => {
    expect(() => validateEnv({ ...base, MP_HTTP_TIMEOUT_MS: 'abc' })).toThrow(
      /Config de entorno inválida/,
    );
  });

  it('una MP_ACCESS_TOKEN vacía NO cuenta como presente', () => {
    expect(() => validateEnv({ ...base, MP_ACCESS_TOKEN: '' })).toThrow(
      /Config de entorno inválida/,
    );
  });
});

describe('Medio simulado (US-010 T7.2, ADR-0006) — defaults y fail-fast', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'test-secret',
  };

  it('sin ninguna variable, aplica los defaults exactos (apagado)', () => {
    const env = validateEnv({ ...base });

    expect(env.PAYMENTS_SIMULATED_ENABLED).toBe('false');
    expect(env.PAYMENTS_SIMULATE_RATE_LIMIT_MAX).toBe(10);
    expect(env.PAYMENTS_SIMULATE_RATE_LIMIT_TTL_MS).toBe(600_000);
  });

  it('en DESARROLLO con PAYMENTS_SIMULATED_ENABLED=true parsea OK', () => {
    const env = validateEnv({ ...base, NODE_ENV: 'development', PAYMENTS_SIMULATED_ENABLED: 'true' });
    expect(env.PAYMENTS_SIMULATED_ENABLED).toBe('true');
  });

  it('en PRODUCCIÓN con PAYMENTS_SIMULATED_ENABLED=true hace fallar el arranque (ADR-0006)', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        PAYMENTS_SIMULATED_ENABLED: 'true',
        RESEND_API_KEY: 'k',
        PASSWORD_RESET_FROM: 'a@b.com',
        PASSWORD_RESET_URL_BASE: 'https://dsm.test/reset',
        GEMINI_API_KEY: 'g_x',
        MP_ACCESS_TOKEN: 'token',
        MP_WEBHOOK_SECRET: 'secreto',
      }),
    ).toThrow(/PAYMENTS_SIMULATED_ENABLED/);
  });

  it('en PRODUCCIÓN con el flag apagado (default), arranca', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      RESEND_API_KEY: 'k',
      PASSWORD_RESET_FROM: 'a@b.com',
      PASSWORD_RESET_URL_BASE: 'https://dsm.test/reset',
      GEMINI_API_KEY: 'g_x',
      MP_ACCESS_TOKEN: 'token',
      MP_WEBHOOK_SECRET: 'secreto',
    });
    expect(env.PAYMENTS_SIMULATED_ENABLED).toBe('false');
  });

  it('PAYMENTS_SIMULATED_ENABLED sólo acepta true|false', () => {
    expect(() =>
      validateEnv({ ...base, PAYMENTS_SIMULATED_ENABLED: 'yes' }),
    ).toThrow(/fail-fast|Config de entorno inválida/);
  });
});

describe('Jobs admin de US-010 (T9.1/T10/T11) — defaults y fail-fast', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'test-secret',
  };

  it('sin ninguna variable, aplica los defaults exactos', () => {
    const env = validateEnv({ ...base });

    expect(env.RECONCILE_MIN_AGE_MS).toBe(300_000);
    expect(env.RECONCILE_BATCH_SIZE).toBe(50);
    expect(env.ORDER_ABANDON_HOURS).toBe(48);
    expect(env.REFUND_RETRY_BATCH_SIZE).toBe(50);
  });

  it('un valor no numérico hace fallar el arranque, no cae al default', () => {
    expect(() => validateEnv({ ...base, RECONCILE_BATCH_SIZE: 'abc' })).toThrow(
      /Config de entorno inválida/,
    );
    expect(() => validateEnv({ ...base, ORDER_ABANDON_HOURS: 'abc' })).toThrow(
      /Config de entorno inválida/,
    );
  });
});
