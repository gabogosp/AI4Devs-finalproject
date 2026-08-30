import type { Resolver } from 'react-hook-form';
import { toNestErrors } from '@hookform/resolvers';
import { CreateGuestCheckoutBody } from '@/api/generated/zod';
import type { CreateCheckoutRequest } from '@/api/generated/model';
import { friendlyMessage } from './checkoutFieldMessages';

export type CheckoutFormValues = CreateCheckoutRequest;

/**
 * Resolver de `react-hook-form` sobre el schema **generado**
 * (`CreateGuestCheckoutBody`), no un `zodResolver` directo: éste traduce los
 * `issues` con `friendlyMessage` (D3) en vez de dejar el inglés genérico de Zod.
 * El schema que valida sigue siendo el del contrato — nunca uno declarado acá.
 *
 * `toNestErrors` (de `@hookform/resolvers`, la misma dependencia que usa
 * `zodResolver` internamente) anida los errores por `path` — `errors.buyer.email`,
 * no un string plano — así RHF los resuelve igual que con cualquier otro resolver.
 */
export const checkoutResolver: Resolver<CheckoutFormValues> = async (values, _context, options) => {
  const result = CreateGuestCheckoutBody.safeParse(values);
  if (result.success) {
    return { values: result.data, errors: {} };
  }

  const flat: Record<string, { type: string; message: string }> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!flat[key]) {
      flat[key] = { type: issue.code, message: friendlyMessage(issue.path) };
    }
  }

  return { values: {}, errors: toNestErrors(flat, options) };
};
