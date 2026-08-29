import { BadRequestException } from '@nestjs/common';
import { mapErrorToProblem } from './http-problem.filter';
import {
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '../errors/domain-errors';

describe('mapErrorToProblem (RFC 7807, problem-filter)', () => {
  it('NotFoundError → 404 con envelope', () => {
    const p = mapErrorToProblem(new NotFoundError('Producto no existe'), '/v1/admin/products/x');
    expect(p.status).toBe(404);
    expect(p.type).toBe('dsm:catalog/not-found');
    expect(p.instance).toBe('/v1/admin/products/x');
    expect(p.detail).toBe('Producto no existe');
  });

  it('ConflictError → 409', () => {
    expect(mapErrorToProblem(new ConflictError('SKU duplicado'), '/x').status).toBe(409);
  });

  it('ValidationError con errores por campo → 422 + errors[]', () => {
    const p = mapErrorToProblem(
      new ValidationError('inválido', [{ field: 'price_ars_cents', message: 'debe ser > 0' }]),
      '/x',
    );
    expect(p.status).toBe(422);
    expect(p.errors).toEqual([{ field: 'price_ars_cents', message: 'debe ser > 0' }]);
  });

  it('InvalidTransitionError → 422', () => {
    expect(mapErrorToProblem(new InvalidTransitionError('no se puede publicar'), '/x').status).toBe(422);
  });

  it('BadRequestException de class-validator → 400 con errors[] por campo', () => {
    const ex = new BadRequestException({
      message: ['price_ars_cents must not be less than 1', 'name should not be empty'],
      error: 'Bad Request',
      statusCode: 400,
    });
    const p = mapErrorToProblem(ex, '/v1/admin/products');
    expect(p.status).toBe(400);
    expect(p.errors?.map((e) => e.field)).toEqual(['price_ars_cents', 'name']);
  });

  it('error de Prisma crudo NO filtra internals → 500 genérico', () => {
    const prismaErr = Object.assign(
      new Error(
        'Invalid `prisma.product.create()` invocation: Unique constraint failed on the fields: (`sku`)',
      ),
      { code: 'P2002' },
    );
    const p = mapErrorToProblem(prismaErr, '/x');
    expect(p.status).toBe(500);
    expect(p.detail).not.toMatch(/prisma/i);
    expect(p.detail).not.toMatch(/P2002/);
    expect(JSON.stringify(p)).not.toMatch(/Unique constraint/);
  });
});
