export type AnonymizationReason = 'retention_policy' | 'requested';

/** No colisiona con ningún comprador real ni pasado ni futuro (US §9 — irreversibilidad). */
export const ANONYMIZED_BUYER_NAME = 'Comprador anonimizado';
/** TLD `.invalid` — RFC 2606, reservado y no resoluble: si algún día un adapter de
 * email (US-011, todavía no construido) intentara enviar a este valor, la entrega
 * fallaría en DNS, nunca llegaría a un tercero real. */
export const ANONYMIZED_BUYER_EMAIL = 'datos-suprimidos@anonimizado.dsm.invalid';
export const ANONYMIZED_BUYER_PHONE = '+00 000-0000';
