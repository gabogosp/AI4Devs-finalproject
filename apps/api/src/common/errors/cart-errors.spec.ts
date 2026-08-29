import { mapErrorToProblem } from '../filters/http-problem.filter';
import { CartTooManyItemsError, InsufficientStockError } from './cart-errors';
import { NotFoundError } from './domain-errors';

/**
 * T3.1 — los dos errores del carrito y los extension members de RFC 7807 §3.2.
 *
 * Se ejerce `mapErrorToProblem` (función pura) y no el filtro entero: lo que hay
 * que probar es la **forma del cuerpo**, y eso no necesita HTTP.
 */
const INSTANCE = '/v1/cart/items/taco-fischer';

describe('errores del carrito (dsm:cart/*)', () => {
  describe('InsufficientStockError (AC-5)', () => {
    it('es 409 con el type del catálogo cerrado', () => {
      const problem = mapErrorToProblem(new InsufficientStockError(3), INSTANCE);

      expect(problem.status).toBe(409);
      expect(problem.type).toBe('dsm:cart/insufficient-stock');
      expect(problem.title).toBe('Conflict');
      expect(problem.instance).toBe(INSTANCE);
    });

    it('available_quantity es campo de PRIMER NIVEL, no texto dentro del detail', () => {
      // El FE necesita el número para topear el stepper; sacarlo del `detail` con
      // una regex se rompe al primer cambio de redacción.
      const problem = mapErrorToProblem(new InsufficientStockError(3), INSTANCE);

      expect(problem.available_quantity).toBe(3);
      expect(typeof problem.available_quantity).toBe('number');
    });

    it('con stock 0 informa 0, no omite el campo', () => {
      const problem = mapErrorToProblem(new InsufficientStockError(0), INSTANCE);
      expect(problem.available_quantity).toBe(0);
    });

    it('el detail no filtra el token del carrito ni datos internos', () => {
      const problem = mapErrorToProblem(new InsufficientStockError(3), INSTANCE);
      expect(problem.detail).toBe(
        'No hay stock suficiente para la cantidad pedida',
      );
    });
  });

  describe('CartTooManyItemsError (§7.3, cota de líneas)', () => {
    it('es 409 con su type y max_items en el cuerpo', () => {
      const problem = mapErrorToProblem(new CartTooManyItemsError(50), INSTANCE);

      expect(problem.status).toBe(409);
      expect(problem.type).toBe('dsm:cart/too-many-items');
      expect(problem.max_items).toBe(50);
    });
  });

  describe('el cambio es ADITIVO', () => {
    it('un error sin extensions produce el cuerpo EXACTO de antes', () => {
      // `toEqual` y no `toMatchObject`: si el soporte de extensions agregara una
      // clave (aunque fuera `extensions: undefined`), este test lo caza.
      expect(
        mapErrorToProblem(new NotFoundError('Producto no encontrado'), INSTANCE),
      ).toEqual({
        type: 'dsm:catalog/not-found',
        title: 'Not Found',
        status: 404,
        detail: 'Producto no encontrado',
        instance: INSTANCE,
      });
    });

    it('el cuerpo del 409 de stock son las 5 claves del envelope + la extensión', () => {
      const problem = mapErrorToProblem(new InsufficientStockError(3), INSTANCE);

      expect(Object.keys(problem).sort()).toEqual(
        [
          'type',
          'title',
          'status',
          'detail',
          'instance',
          'available_quantity',
        ].sort(),
      );
    });
  });

  describe('un extension member no puede pisar el contrato del envelope', () => {
    it('una extensión llamada `status` se ignora', () => {
      // Si pudiera, el cuerpo diría un status distinto del HTTP real y cualquier
      // cliente que ramifique por el cuerpo tomaría la rama equivocada.
      class ErrorTramposo extends NotFoundError {
        readonly extensions = { status: 200, type: 'dsm:falso', extra: 'ok' };
      }

      const problem = mapErrorToProblem(new ErrorTramposo('no está'), INSTANCE);

      expect(problem.status).toBe(404);
      expect(problem.type).toBe('dsm:catalog/not-found');
      expect(problem.extra).toBe('ok');
    });
  });
});
