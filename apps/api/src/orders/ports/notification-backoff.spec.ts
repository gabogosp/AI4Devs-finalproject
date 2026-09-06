import { backoffDelayMs, isTransientResendError } from './notification-backoff';

describe('backoffDelayMs (US-011 T3.1)', () => {
  it('el intento 0 cae dentro de [baseMs/2, baseMs]', () => {
    const delay = backoffDelayMs(0, { baseMs: 300, capMs: 2_000 });
    expect(delay).toBeGreaterThanOrEqual(150);
    expect(delay).toBeLessThanOrEqual(300);
  });

  it('un intento alto nunca supera el cap', () => {
    const delay = backoffDelayMs(10, { baseMs: 300, capMs: 2_000 });
    expect(delay).toBeLessThanOrEqual(2_000);
  });
});

describe('isTransientResendError (US-011 T3.1)', () => {
  it('429 es transitorio', () => {
    expect(isTransientResendError(429)).toBe(true);
  });

  it('5xx es transitorio', () => {
    expect(isTransientResendError(500)).toBe(true);
    expect(isTransientResendError(503)).toBe(true);
  });

  it('null/undefined (sin statusCode, p.ej. excepción de red) es transitorio', () => {
    expect(isTransientResendError(null)).toBe(true);
    expect(isTransientResendError(undefined)).toBe(true);
  });

  it('4xx que no es 429 es permanente', () => {
    expect(isTransientResendError(400)).toBe(false);
    expect(isTransientResendError(422)).toBe(false);
  });
});
