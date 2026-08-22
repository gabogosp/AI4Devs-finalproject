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
