import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasSessionHint, SESSION_HINT_KEY, setSessionHint } from './sessionState';

/** US-014 T1.2 — la marca no-secreta que evita el `/auth/me` del anónimo. */
describe('marca de sesión (OQ-FE-4)', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sin marca previa, no hay sesión que sospechar', () => {
    expect(hasSessionHint()).toBe(false);
  });

  it('se escribe y se lee', () => {
    setSessionHint(true);
    expect(window.localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
    expect(hasSessionHint()).toBe(true);
  });

  it('borrarla la saca del storage, no la deja en falso', () => {
    setSessionHint(true);
    setSessionHint(false);
    expect(window.localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
    expect(hasSessionHint()).toBe(false);
  });

  it('un valor arbitrario no cuenta como marca', () => {
    // La marca es una pista binaria: cualquier otra cosa se ignora en vez de
    // interpretarse, así nadie la usa como canal de datos.
    window.localStorage.setItem(SESSION_HINT_KEY, 'lo-que-sea');
    expect(hasSessionHint()).toBe(false);
  });

  it('si el storage lanza (Safari privado), no rompe: devuelve false', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    // El peor caso de no poder leerla es un `/auth/me` de más, no una pantalla
    // rota.
    expect(() => hasSessionHint()).not.toThrow();
    expect(hasSessionHint()).toBe(false);
  });

  it('si el storage lanza al escribir, tampoco rompe', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });

    expect(() => setSessionHint(true)).not.toThrow();
  });
});
