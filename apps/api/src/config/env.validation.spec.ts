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
    expect(env.GEMINI_MAX_RPM).toBe(15);
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
