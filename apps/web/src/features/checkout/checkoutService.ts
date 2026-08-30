import { createGuestCheckout } from '@/api/generated/endpoints';
import { CreateGuestCheckoutResponse } from '@/api/generated/zod';
import type { CheckoutCreated, CreateCheckoutRequest } from '@/api/generated/model';
import { parseContract } from '@/lib/http/contract';

export type { CheckoutCreated, CreateCheckoutRequest };

/**
 * Repositorio del checkout (`frontend-standards.md` §3.3/§11.5) — lo único
 * escrito a mano; la red va por la operación **generada** (F48) y la respuesta
 * se valida en el borde con el schema Zod generado.
 *
 * `session: 'cart'`: mismo sujeto de CSRF que el carrito (`dsm_cart_csrf`) —
 * cero cambios en `client.ts`/`csrf.ts` (precedente exacto de `cartService.ts`).
 * Sin esa opción la llamada sale sin `credentials`/CSRF y el backend responde 403.
 */
export const checkoutService = {
  async submit(input: CreateCheckoutRequest): Promise<CheckoutCreated> {
    const res = await createGuestCheckout(input, { session: 'cart' });
    return parseContract(CreateGuestCheckoutResponse, res.data);
  },
};
