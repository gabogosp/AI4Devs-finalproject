import { DomainError } from '../common/errors/domain-errors';
import { ReportsInvalidRangeError } from './reports-errors';

describe('ReportsInvalidRangeError', () => {
  it('es un 422 con type dsm:reports/invalid-range', () => {
    const error = new ReportsInvalidRangeError('2026-02-01', '2026-01-01');

    expect(error).toBeInstanceOf(DomainError);
    expect(error.status).toBe(422);
    expect(error.type).toBe('dsm:reports/invalid-range');
    expect(error.message).toContain('2026-02-01');
    expect(error.message).toContain('2026-01-01');
  });

  it('acepta from/to ausentes (defaults) sin lanzar al construirse', () => {
    const error = new ReportsInvalidRangeError();

    expect(error.status).toBe(422);
    expect(error.message).toContain('(default)');
  });
});
