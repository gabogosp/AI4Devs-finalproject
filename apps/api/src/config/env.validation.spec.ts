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
