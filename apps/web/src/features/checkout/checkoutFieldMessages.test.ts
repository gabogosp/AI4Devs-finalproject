import { describe, expect, it } from 'vitest';
import { friendlyMessage } from './checkoutFieldMessages';

describe('checkoutFieldMessages — traducción de issues Zod (D3)', () => {
  it('buyer.email y consent tienen mensajes distintos', () => {
    expect(friendlyMessage(['buyer', 'email'])).not.toBe(friendlyMessage(['consent']));
  });

  it('un path desconocido devuelve un fallback genérico en vez de lanzar', () => {
    expect(() => friendlyMessage(['algo', 'inesperado'])).not.toThrow();
    expect(friendlyMessage(['algo', 'inesperado'])).toBe('Revisá este campo.');
  });

  it('cubre los cuatro campos del contrato', () => {
    expect(friendlyMessage(['buyer', 'name'])).toMatch(/nombre/i);
    expect(friendlyMessage(['buyer', 'email'])).toMatch(/email/i);
    expect(friendlyMessage(['buyer', 'phone'])).toMatch(/teléfono/i);
    expect(friendlyMessage(['consent'])).toMatch(/términos/i);
  });
});
