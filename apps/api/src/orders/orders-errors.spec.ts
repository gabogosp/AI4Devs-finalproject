import { mapErrorToProblem } from '../common/filters/http-problem.filter';
import { OrderInvalidTransitionError, OrderNotFoundError } from './orders-errors';

/**
 * T2.1 — los dos errores del panel admin de órdenes, ejercidos a través del
 * filtro REAL (`mapErrorToProblem`), no de un doble.
 */
const INSTANCE = '/v1/admin/orders/11111111-1111-1111-1111-111111111111';

describe('errores del panel admin de órdenes (dsm:orders/*)', () => {
  describe('OrderInvalidTransitionError (AC-6)', () => {
    it('es 409, no 422 (decisión local a orders — design.md §D3)', () => {
      const problem = mapErrorToProblem(
        new OrderInvalidTransitionError('new', 'delivered'),
        INSTANCE,
      );

      expect(problem.status).toBe(409);
      expect(problem.type).toBe('dsm:orders/invalid-transition');
      expect(problem.title).toBe('Conflict');
      expect(problem.instance).toBe(INSTANCE);
    });

    it('el detail no contiene el nombre de la clase ni un stack', () => {
      const problem = mapErrorToProblem(
        new OrderInvalidTransitionError('new', 'delivered'),
        INSTANCE,
      );
      expect(problem.detail).not.toContain('Error:');
      expect(problem.detail).not.toContain('at ');
      expect(problem.detail).not.toContain('OrderInvalidTransitionError');
    });
  });

  describe('OrderNotFoundError (AC-8)', () => {
    it('es 404 con el type propio del módulo', () => {
      const problem = mapErrorToProblem(
        new OrderNotFoundError('La orden no existe'),
        INSTANCE,
      );

      expect(problem.status).toBe(404);
      expect(problem.type).toBe('dsm:orders/not-found');
      expect(problem.title).toBe('Not Found');
      expect(problem.instance).toBe(INSTANCE);
    });
  });
});
