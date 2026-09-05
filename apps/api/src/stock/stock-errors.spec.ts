import { mapErrorToProblem } from '../common/filters/http-problem.filter';
import { InsufficientStockError } from './stock-errors';

const INSTANCE = '/v1/admin/orders/8d64fd62-fcaf-4243-ac0c-dd0b49c35ef7/confirm-payment';

describe('InsufficientStockError (dsm:payments/insufficient-stock)', () => {
  it('es 409 con el type esperado, en application/problem+json', () => {
    const problem = mapErrorToProblem(
      new InsufficientStockError('7c1a2b3c-4d5e-4f60-8a1b-2c3d4e5f6071'),
      INSTANCE,
    );

    expect(problem.status).toBe(409);
    expect(problem.type).toBe('dsm:payments/insufficient-stock');
    expect(problem.title).toBe('Conflict');
    expect(problem.instance).toBe(INSTANCE);
  });

  it('el detail no contiene el nombre de la clase ni un stack', () => {
    const problem = mapErrorToProblem(
      new InsufficientStockError('7c1a2b3c-4d5e-4f60-8a1b-2c3d4e5f6071'),
      INSTANCE,
    );
    expect(problem.detail).not.toContain('Error:');
    expect(problem.detail).not.toContain('at ');
    expect(problem.detail).not.toContain('InsufficientStockError');
  });
});
