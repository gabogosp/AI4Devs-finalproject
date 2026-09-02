import { mapErrorToProblem } from '../common/filters/http-problem.filter';
import {
  OrderNotFoundError,
  OrderNotPendingPaymentError,
} from './payment-confirmation-errors';

const INSTANCE = '/v1/admin/orders/8d64fd62-fcaf-4243-ac0c-dd0b49c35ef7/confirm-payment';

describe('errores de confirmación de pago (dsm:payments/*)', () => {
  describe('OrderNotPendingPaymentError (AC-4/AC-5)', () => {
    it('es 409 con el detail mencionando el estado actual', () => {
      const problem = mapErrorToProblem(new OrderNotPendingPaymentError('new'), INSTANCE);

      expect(problem.status).toBe(409);
      expect(problem.type).toBe('dsm:payments/order-not-pending-payment');
      expect(problem.detail).toContain('new');
    });

    it('sin estado explícito, igual es 409 con detail genérico', () => {
      const problem = mapErrorToProblem(new OrderNotPendingPaymentError(), INSTANCE);
      expect(problem.status).toBe(409);
      expect(problem.detail).toBe('La orden no está pendiente de pago');
    });

    it('el detail no contiene el nombre de la clase ni un stack', () => {
      const problem = mapErrorToProblem(new OrderNotPendingPaymentError('cancelled'), INSTANCE);
      expect(problem.detail).not.toContain('Error:');
      expect(problem.detail).not.toContain('at ');
      expect(problem.detail).not.toContain('OrderNotPendingPaymentError');
    });
  });

  describe('OrderNotFoundError', () => {
    it('es 404 con el type esperado', () => {
      const problem = mapErrorToProblem(new OrderNotFoundError(), INSTANCE);
      expect(problem.status).toBe(404);
      expect(problem.type).toBe('dsm:payments/order-not-found');
    });
  });
});
