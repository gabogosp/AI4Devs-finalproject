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
