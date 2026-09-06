import { describe, expect, it } from 'vitest';
import { describeClamp } from './rangeClampNote';

describe('describeClamp', () => {
  it('devuelve null cuando no se pidió un `from`', () => {
    expect(describeClamp(undefined, '2025-09-01T00:00:00Z')).toBeNull();
  });

  it('devuelve null cuando el `from` efectivo coincide con el pedido', () => {
    expect(
      describeClamp('2025-09-01T00:00:00Z', '2025-09-01T00:00:00Z'),
    ).toBeNull();
  });

  it('devuelve un texto con la fecha efectiva cuando el backend acotó el rango', () => {
    const nota = describeClamp('2020-01-01T00:00:00Z', '2025-09-01T00:00:00Z');

    expect(nota).toContain('01/09/2025');
    expect(nota).toContain('política de retención');
  });
});
