import { describe, expect, it } from 'vitest';
import { mapProblemToAppError, networkError } from './errors';

describe('mapProblemToAppError (RFC 7807 → AppError)', () => {
  it('422 → validation con fieldErrors', () => {
    const e = mapProblemToAppError(422, {
      type: 'dsm:catalog/validation',
      status: 422,
      detail: 'inválido',
      errors: [{ field: 'price_ars_cents', message: 'debe ser > 0' }],
    });
    expect(e.kind).toBe('validation');
    if (e.kind === 'validation') {
      expect(e.fieldErrors).toEqual([
        { field: 'price_ars_cents', message: 'debe ser > 0' },
      ]);
    }
  });

  it('409 → conflict', () => {
    expect(mapProblemToAppError(409, { detail: 'SKU duplicado' }).kind).toBe(
      'conflict',
    );
  });

  it('401 → unauthorized, 403 → forbidden, 404 → notFound', () => {
    expect(mapProblemToAppError(401, {}).kind).toBe('unauthorized');
    expect(mapProblemToAppError(403, {}).kind).toBe('forbidden');
    expect(mapProblemToAppError(404, {}).kind).toBe('notFound');
  });

  it('5xx → server sin filtrar el body crudo', () => {
    const e = mapProblemToAppError(500, {
      detail: 'Invalid prisma.product.create() P2002',
    });
    expect(e.kind).toBe('server');
    expect(e.message).not.toMatch(/prisma/i);
  });

  it('networkError → kind network', () => {
    expect(networkError().kind).toBe('network');
  });
});
