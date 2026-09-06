import { mapErrorToProblem } from '../common/filters/http-problem.filter';
import { AccountHasActiveOrdersError } from './account-errors';

const INSTANCE = '/v1/me';

describe('AccountHasActiveOrdersError (US-020 T2.1)', () => {
  it('es 409 con dsm:account/active-orders', () => {
    const problem = mapErrorToProblem(new AccountHasActiveOrdersError([]), INSTANCE);

    expect(problem.status).toBe(409);
    expect(problem.type).toBe('dsm:account/active-orders');
    expect(problem.title).toBe('Conflict');
    expect(problem.instance).toBe(INSTANCE);
  });

  it('blocking_orders es campo de PRIMER NIVEL con el shape de OrderHistorySummaryDto', () => {
    const orden = {
      order_number: 1042,
      status: 'new',
      total_ars_cents: 850_000,
      created_at: '2026-08-01T00:00:00.000Z',
    };
    const problem = mapErrorToProblem(
      new AccountHasActiveOrdersError([orden]),
      INSTANCE,
    );

    expect(problem.blocking_orders).toEqual([orden]);
  });

  it('sin órdenes bloqueantes, blocking_orders es un array vacío (no se omite el campo)', () => {
    const problem = mapErrorToProblem(new AccountHasActiveOrdersError([]), INSTANCE);
    expect(problem.blocking_orders).toEqual([]);
  });
});
