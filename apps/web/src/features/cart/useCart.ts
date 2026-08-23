'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { AppError } from '@/lib/http/errors';
import { isAppError } from '@/lib/http/errors';
import { cartService, type Cart } from './cartService';

/**
 * Conflicto de una línea (409). Se guarda **por slug** porque es información de
 * esa línea, no del carrito: dos líneas pueden estar en conflicto a la vez y
 * cada una muestra su propio «quedan N».
 */
export interface LineConflict {
  message: string;
  availableQuantity?: number;
}

/**
 * Estado como **unión discriminada** (`frontend-standards.md` §11.4): nunca
 * banderas booleanas ni campos nulables que haya que cruzar para saber qué está
 * pasando.
 *
 * `mutatingSlugs` es **por línea** a propósito: cambiar la cantidad de un ítem
 * no puede congelar el resto del carrito.
 *
 * En `error` el `cart` previo se **conserva**: si el error tirara el carrito, un
 * fallo de red dejaría la pantalla vacía y parecería que el carrito se borró.
 */
export type CartState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready';
      cart: Cart;
      mutatingSlugs: string[];
      conflicts: Record<string, LineConflict>;
    }
  | { kind: 'error'; error: AppError; cart?: Cart };

type Action =
  | { type: 'load' }
  | { type: 'loaded'; cart: Cart }
  | { type: 'mutating'; slug: string }
  | { type: 'mutated'; slug: string; cart: Cart }
  | { type: 'conflict'; slug: string; conflict: LineConflict }
  | { type: 'failed'; slug?: string; error: AppError };

function sinSlug(slugs: string[], slug: string): string[] {
  return slugs.filter((s) => s !== slug);
}

function cartDe(state: CartState): Cart | undefined {
  if (state.kind === 'ready') return state.cart;
  if (state.kind === 'error') return state.cart;
  return undefined;
}

export function cartReducer(state: CartState, action: Action): CartState {
  switch (action.type) {
    case 'load':
      // Una recarga sobre un carrito ya visible no lo esconde: `loading` sólo
      // aplica cuando todavía no hay nada que mostrar.
      return state.kind === 'ready' ? state : { kind: 'loading' };

    case 'loaded':
      return {
        kind: 'ready',
        cart: action.cart,
        mutatingSlugs: [],
        conflicts: {},
      };

    case 'mutating': {
      if (state.kind !== 'ready') return state;
      const { [action.slug]: _resuelto, ...resto } = state.conflicts;
      return {
        ...state,
        mutatingSlugs: [...sinSlug(state.mutatingSlugs, action.slug), action.slug],
        conflicts: resto,
      };
    }

    case 'mutated': {
      // El servidor devuelve el carrito COMPLETO en las tres operaciones, así
      // que se REEMPLAZA en vez de parchear: no hay estado local que pueda
      // divergir de la verdad del servidor (AC-9).
      const conflicts = state.kind === 'ready' ? state.conflicts : {};
      const { [action.slug]: _limpio, ...resto } = conflicts;
      return {
        kind: 'ready',
        cart: action.cart,
        mutatingSlugs:
          state.kind === 'ready' ? sinSlug(state.mutatingSlugs, action.slug) : [],
        conflicts: resto,
      };
    }

    case 'conflict': {
      // Un 409 NO tira el carrito: la cantidad pedida no se aplicó, todo lo
      // demás sigue igual y la línea muestra cuántas unidades hay.
      if (state.kind !== 'ready') return state;
      return {
        ...state,
        mutatingSlugs: sinSlug(state.mutatingSlugs, action.slug),
        conflicts: { ...state.conflicts, [action.slug]: action.conflict },
      };
    }

    case 'failed': {
      const cart = cartDe(state);
      return { kind: 'error', error: action.error, ...(cart ? { cart } : {}) };
    }

    default:
      return state;
  }
}

function appErrorDe(error: unknown): AppError {
  if (isAppError(error)) return error.appError;
  return { kind: 'network', message: 'No se pudo conectar con el servidor' };
}

export interface UseCart {
  state: CartState;
  /** Cantidad de unidades para el badge; `undefined` mientras no se sabe. */
  totalQuantity: number | undefined;
  reload: () => Promise<void>;
  /** Suma una unidad (o crea la línea con 1). El PUT es absoluto, así que la suma se calcula acá. */
  add: (slug: string) => Promise<void>;
  setQuantity: (slug: string, quantity: number) => Promise<void>;
  remove: (slug: string) => Promise<void>;
}

/**
 * Estado del carrito. Un `useReducer` + el contexto de `CartProvider` alcanzan:
 * los consumidores son dos (la página y el badge) y el servidor devuelve el
 * estado completo en cada mutación, así que un store global sería infraestructura
 * para un problema que no existe (`base-standards.md` §1 — YAGNI).
 */
export function useCart(options: { autoload?: boolean } = {}): UseCart {
  const { autoload = true } = options;
  const [state, dispatch] = useReducer(cartReducer, { kind: 'idle' } as CartState);
  // Evita el doble fetch del StrictMode en desarrollo.
  const cargado = useRef(false);

  /**
   * Lectura con **single-flight**: si ya hay una en vuelo, se devuelve la misma
   * promesa en vez de disparar otra.
   *
   * No es una optimización: el badge del top-nav, la página del carrito y
   * cualquier otro consumidor comparten este hook y llaman `reload()` al montar,
   * así que sin esto una visita dispara varios `GET /v1/cart` y —peor— la
   * rejección de la segunda no la consume nadie (aparece como unhandled).
   */
  const enVuelo = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    if (enVuelo.current) return enVuelo.current;

    dispatch({ type: 'load' });
    const promesa = (async () => {
      try {
        dispatch({ type: 'loaded', cart: await cartService.get() });
      } catch (error) {
        dispatch({ type: 'failed', error: appErrorDe(error) });
      } finally {
        enVuelo.current = null;
      }
    })();
    enVuelo.current = promesa;
    return promesa;
  }, []);

  const mutar = useCallback(
    async (slug: string, operacion: () => Promise<Cart>) => {
      dispatch({ type: 'mutating', slug });
      try {
        dispatch({ type: 'mutated', slug, cart: await operacion() });
      } catch (error) {
        const appError = appErrorDe(error);
        if (appError.kind === 'conflict') {
          dispatch({
            type: 'conflict',
            slug,
            conflict: {
              message: appError.message,
              ...(appError.availableQuantity !== undefined
                ? { availableQuantity: appError.availableQuantity }
                : {}),
            },
          });
          return;
        }
        dispatch({ type: 'failed', slug, error: appError });
      }
    },
    [],
  );

  const setQuantity = useCallback(
    (slug: string, quantity: number) =>
      mutar(slug, () => cartService.setItemQuantity(slug, quantity)),
    [mutar],
  );

  const add = useCallback(
    (slug: string) => {
      // El PUT fija la cantidad absoluta, así que «agregar» es leer la actual y
      // sumarle uno. Sin línea previa (o sin carrito cargado) es 1.
      const cart = cartDe(state);
      const actual = cart?.items.find((i) => i.slug === slug);
      const siguiente = actual
        ? Math.min(actual.quantity + 1, actual.max_quantity)
        : 1;
      return mutar(slug, () => cartService.setItemQuantity(slug, siguiente));
    },
    [mutar, state],
  );

  const remove = useCallback(
    (slug: string) => mutar(slug, () => cartService.removeItem(slug)),
    [mutar],
  );

  useEffect(() => {
    if (!autoload || cargado.current) return;
    cargado.current = true;
    void reload();
  }, [autoload, reload]);

  const totalQuantity = useMemo(() => cartDe(state)?.total_quantity, [state]);

  return { state, totalQuantity, reload, add, setQuantity, remove };
}
