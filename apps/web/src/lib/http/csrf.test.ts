import { afterEach, describe, expect, it } from 'vitest';
import { readCsrfToken, requiereCsrf } from './csrf';

/** US-014 T0.5 — lectura de la cookie legible y métodos que exigen el header. */
describe('readCsrfToken', () => {
  afterEach(() => {
    document.cookie = 'dsm_csrf=; Max-Age=0; Path=/';
    document.cookie = 'otra=; Max-Age=0; Path=/';
  });

  it('lee el valor de dsm_csrf', () => {
    document.cookie = 'dsm_csrf=abc123; Path=/';
    expect(readCsrfToken()).toBe('abc123');
  });

  it('lo encuentra aunque haya otras cookies antes', () => {
    document.cookie = 'otra=ruido; Path=/';
    document.cookie = 'dsm_csrf=abc123; Path=/';
    expect(readCsrfToken()).toBe('abc123');
  });

  it('no confunde una cookie cuyo nombre TERMINA en dsm_csrf', () => {
    // `x_dsm_csrf` no es `dsm_csrf`: sin el ancla de borde, el match sería el
    // valor equivocado y el header saldría con un token ajeno.
    document.cookie = 'x_dsm_csrf=valor-ajeno; Path=/';
    expect(readCsrfToken()).toBeNull();
  });

  it('decodifica el valor', () => {
    document.cookie = `dsm_csrf=${encodeURIComponent('a b+c')}; Path=/`;
    expect(readCsrfToken()).toBe('a b+c');
  });

  it('sin la cookie devuelve null (no inventa un valor)', () => {
    expect(readCsrfToken()).toBeNull();
  });
});

describe('requiereCsrf', () => {
  it('las escrituras lo exigen', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      expect(requiereCsrf(m)).toBe(true);
    }
  });

  it('los métodos seguros no', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get', undefined]) {
      expect(requiereCsrf(m)).toBe(false);
    }
  });
});
