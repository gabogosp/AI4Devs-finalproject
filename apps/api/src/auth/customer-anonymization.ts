/**
 * Constantes de anonimización de `customers` (US-020, `design.md` §Approach),
 * espejo de `checkout/order-anonymization.ts` (US-021).
 *
 * El email es **función**, no constante: `customers.email` tiene `UNIQUE`
 * (a diferencia de `orders.buyer_email`), así que dos bajas de cuenta con un
 * valor fijo chocarían en la segunda. `.invalid` es el TLD reservado por
 * RFC 2606 — no resuelve, por diseño.
 */
export const ANONYMIZED_CUSTOMER_NAME = 'Cuenta eliminada';
export const ANONYMIZED_CUSTOMER_PHONE = '+00 000-0000';

export function anonymizedCustomerEmail(customerId: string): string {
  return `cuenta-borrada+${customerId}@anonimizado.dsm.invalid`;
}
