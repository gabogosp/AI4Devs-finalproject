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

  it('409 sin blocking_orders no agrega el campo (regresión cero sobre el 409 del carrito, US-007)', () => {
    const e = mapProblemToAppError(409, {
      detail: 'Sin stock disponible',
      available_quantity: 0,
    });
    expect(e.kind).toBe('conflict');
    if (e.kind === 'conflict') {
      expect(e.availableQuantity).toBe(0);
      expect(e.blockingOrders).toBeUndefined();
    }
  });

  it('409 con blocking_orders (US-020 AC-4/AC-9) propaga el array tal cual, sin transformarlo', () => {
    const blocking_orders = [
      {
        order_number: 1234,
        // Drift de contrato documentado (design.md §D2): el runtime puede
        // emitir `pending_payment`, que el enum publicado no declara — por
        // eso `status` se tipa `string`, no el enum generado.
        status: 'pending_payment',
        total_ars_cents: 500000,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    const e = mapProblemToAppError(409, {
      type: 'dsm:account/active-orders',
      detail: 'Tenés pedidos en curso',
      blocking_orders,
    });
    expect(e.kind).toBe('conflict');
    if (e.kind === 'conflict') {
      expect(e.blockingOrders).toEqual(blocking_orders);
    }
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

describe('429 — rate limit (transitorio, no fallo del servidor)', () => {
  it('se mapea a `rateLimited`, no a `server`', () => {
    // Antes caía en el `default` y, al no ser >= 500, salía como `server`. La
    // página lo relanzaba y el boundary lo convertía en un 500 — el peor código
    // posible en las páginas que existen para ser indexadas.
    const err = mapProblemToAppError(429, { detail: 'Demasiadas solicitudes' }, 30);

    expect(err.kind).toBe('rateLimited');
    expect(err.kind).not.toBe('server');
  });

  it('conserva el Retry-After que manda el backend', () => {
    const err = mapProblemToAppError(429, {}, 30);

    expect(err).toMatchObject({ kind: 'rateLimited', retryAfterSeconds: 30 });
  });

  it('sin Retry-After sigue siendo rateLimited, sin inventar un número', () => {
    const err = mapProblemToAppError(429, {});

    expect(err).toMatchObject({ kind: 'rateLimited' });
    expect((err as { retryAfterSeconds?: number }).retryAfterSeconds).toBeUndefined();
  });

  it('un 5xx real sigue siendo `server` — el 429 no se lleva puesto ese caso', () => {
    expect(mapProblemToAppError(500, {}).kind).toBe('server');
    expect(mapProblemToAppError(503, {}).kind).toBe('server');
  });
});
