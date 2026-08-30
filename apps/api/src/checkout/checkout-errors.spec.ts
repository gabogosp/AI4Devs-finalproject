import { mapErrorToProblem } from '../common/filters/http-problem.filter';
import { CartEmptyError, CartNotPurchasableError } from './checkout-errors';

/**
 * T1.1 — los dos errores del checkout, ejercidos a través del filtro REAL
 * (`mapErrorToProblem`, función pura) y no de un doble: lo que hay que probar es
 * el body/status que un cliente HTTP realmente recibiría.
 */
const INSTANCE = '/v1/checkout';

describe('errores del checkout (dsm:checkout/*)', () => {
  describe('CartEmptyError (AC-5)', () => {
    it('es 409 con el type del catálogo cerrado, en application/problem+json', () => {
      const problem = mapErrorToProblem(new CartEmptyError(), INSTANCE);

      expect(problem.status).toBe(409);
      expect(problem.type).toBe('dsm:checkout/cart-empty');
      expect(problem.title).toBe('Conflict');
      expect(problem.instance).toBe(INSTANCE);
    });

    it('el detail no contiene el nombre de la clase ni un stack', () => {
      const problem = mapErrorToProblem(new CartEmptyError(), INSTANCE);
      expect(problem.detail).not.toContain('Error:');
      expect(problem.detail).not.toContain('at ');
      expect(problem.detail).not.toContain('CartEmptyError');
    });
  });

  describe('CartNotPurchasableError (AC-5)', () => {
    it('es 409 con errors[] cuyo field es el slug de la línea que molesta', () => {
      const problem = mapErrorToProblem(
        new CartNotPurchasableError([
          { field: 'compresor-embraco', message: 'sin stock suficiente' },
          { field: 'cable-cobre-3x2', message: 'despublicado' },
        ]),
        INSTANCE,
      );

      expect(problem.status).toBe(409);
      expect(problem.type).toBe('dsm:checkout/cart-not-purchasable');
      expect(problem.errors).toEqual([
        { field: 'compresor-embraco', message: 'sin stock suficiente' },
        { field: 'cable-cobre-3x2', message: 'despublicado' },
      ]);
    });

    it('el detail no contiene el nombre de la clase ni un stack', () => {
      const problem = mapErrorToProblem(
        new CartNotPurchasableError([{ field: 'x', message: 'y' }]),
        INSTANCE,
      );
      expect(problem.detail).not.toContain('Error:');
      expect(problem.detail).not.toContain('at ');
      expect(problem.detail).not.toContain('CartNotPurchasableError');
    });
  });
});
