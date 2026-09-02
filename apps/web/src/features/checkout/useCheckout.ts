'use client';

import { useCallback, useReducer, useRef } from 'react';
import type { AppError } from '@/lib/http/errors';
import { isAppError } from '@/lib/http/errors';
import { checkoutService, type CheckoutCreated, type CreateCheckoutRequest } from './checkoutService';

/**
 * Unión discriminada de **una sola operación** (`design.md` D4) — a diferencia
 * del carrito (mutaciones por línea + contexto compartido), acá hay un solo
 * consumidor (`CheckoutForm`), así que un `useReducer` de 4 casos alcanza.
 */
export type CheckoutState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; order: CheckoutCreated }
  | { kind: 'error'; error: AppError };

type Action =
  | { type: 'submit' }
  | { type: 'succeeded'; order: CheckoutCreated }
  | { type: 'failed'; error: AppError };

function reducer(state: CheckoutState, action: Action): CheckoutState {
  switch (action.type) {
    case 'submit':
      return { kind: 'submitting' };
    case 'succeeded':
      return { kind: 'success', order: action.order };
    case 'failed':
      return { kind: 'error', error: action.error };
    default:
      return state;
  }
}

function appErrorDe(error: unknown): AppError {
  if (isAppError(error)) return error.appError;
  return { kind: 'network', message: 'No se pudo conectar con el servidor' };
}

export interface UseCheckout {
  state: CheckoutState;
  submit: (input: CreateCheckoutRequest) => Promise<void>;
}

/**
 * Estado del submit del checkout. **Single-flight**: un segundo `submit`
 * mientras uno ya está en vuelo no dispara una segunda petición — mismo patrón
 * que `reload()` de `useCart.ts`, así un doble click no crea dos órdenes.
 */
export function useCheckout(): UseCheckout {
  const [state, dispatch] = useReducer(reducer, { kind: 'idle' } as CheckoutState);
  const enVuelo = useRef<Promise<void> | null>(null);

  const submit = useCallback(async (input: CreateCheckoutRequest) => {
    if (enVuelo.current) return enVuelo.current;

    dispatch({ type: 'submit' });
    const promesa = (async () => {
      try {
        const order = await checkoutService.submit(input);
        dispatch({ type: 'succeeded', order });
      } catch (error) {
        dispatch({ type: 'failed', error: appErrorDe(error) });
      } finally {
        enVuelo.current = null;
      }
    })();
    enVuelo.current = promesa;
    return promesa;
  }, []);

  return { state, submit };
}
