import { describe, expect, it } from 'vitest';
import { formatArs } from './currency';

describe('formatArs (centavos → ARS)', () => {
  it('formatea sin decimales', () => {
    const out = formatArs(1250000); // 12.500 pesos
    expect(out).toContain('12.500');
    expect(out).toMatch(/\$/);
  });

  it('redondea a entero de peso', () => {
    expect(formatArs(150)).toContain('2'); // 1,5 → 2
  });

  it('cero', () => {
    expect(formatArs(0)).toContain('0');
  });
});
