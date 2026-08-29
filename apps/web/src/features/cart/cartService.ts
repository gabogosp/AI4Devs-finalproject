import { parseContract } from '@/lib/http/contract';
import {
  getCart,
  removeCartItem,
  setCartItem,
} from '@/api/generated/endpoints';
import {
  GetCartResponse,
  RemoveCartItemResponse,
  SetCartItemResponse,
} from '@/api/generated/zod';
import type { Cart, CartItem } from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO — generados desde `apps/api/docs/api/openapi.yaml`
 * (`frontend-standards.md` §3.1/§3.2). Nunca se declaran a mano: un tipo escrito
 * a mano queda verde contra el contrato viejo.
 */
export type { Cart, CartItem };

/**
 * Lógica de servicio del carrito (`frontend-standards.md` §3.3 — lo único que se
 * escribe a mano). La red va por las **operaciones generadas** (F48) y la
 * respuesta se valida en el borde con los schemas Zod generados.
 *
 * Las tres operaciones van marcadas con `session: 'cart'`, que es lo que activa
 * en el cliente centralizado: URL relativa (la resuelve el rewrite de ADR-0013),
 * `credentials: 'include'`, double-submit con `dsm_cart_csrf` y la prohibición de
 * ejecutarse en servidor.
 *
 * Las tres devuelven el **carrito completo**, así que quien consume reemplaza su
 * estado en vez de parchearlo: no hay total calculado en el cliente que pueda
 * divergir del servidor (AC-9).
 *
 * Los errores los traduce `mapProblemToAppError` en el cliente; acá no se
 * re-mapean. Lo que este servicio garantiza es que el 409 llega con su
 * `availableQuantity` intacto, porque el contrato lo expone como campo de primer
 * nivel para eso.
 */
export const cartService = {
  /** Lectura. No crea carrito ni emite cookie: sin cookie devuelve el vacío. */
  async get(signal?: AbortSignal): Promise<Cart> {
    const res = await getCart({ session: 'cart', signal });
    return parseContract(GetCartResponse, res.data).cart;
  },

  /**
   * Fija la cantidad **absoluta** (no suma). Es la operación de agregar y la de
   * editar: el backend la modeló idempotente a propósito (`api-standards` §10.5),
   * así que un doble envío no duplica unidades.
   */
  async setItemQuantity(slug: string, quantity: number): Promise<Cart> {
    const res = await setCartItem(slug, { quantity }, { session: 'cart' });
    return parseContract(SetCartItemResponse, res.data).cart;
  },

  /** Quita la línea. Idempotente: quitar lo que no está devuelve el carrito igual. */
  async removeItem(slug: string): Promise<Cart> {
    const res = await removeCartItem(slug, { session: 'cart' });
    return parseContract(RemoveCartItemResponse, res.data).cart;
  },
};
