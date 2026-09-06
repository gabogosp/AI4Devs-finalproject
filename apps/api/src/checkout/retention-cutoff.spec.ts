import { computeRetentionCutoff } from './retention-cutoff';

describe('computeRetentionCutoff (US-015 T2.3, US-021 design.md §D4)', () => {
  it('12 meses desde 2026-09-06 da 2025-09-06', () => {
    const cutoff = computeRetentionCutoff(12, new Date('2026-09-06'));
    expect(cutoff.toISOString().slice(0, 10)).toBe('2025-09-06');
  });

  it('usa `new Date()` como default cuando no se pasa `now`', () => {
    const antes = Date.now();
    const cutoff = computeRetentionCutoff(0);
    const despues = Date.now();
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(antes);
    expect(cutoff.getTime()).toBeLessThanOrEqual(despues);
  });

  it('no muta la fecha `now` recibida', () => {
    const now = new Date('2026-09-06');
    const copia = new Date(now);
    computeRetentionCutoff(12, now);
    expect(now).toEqual(copia);
  });
});
