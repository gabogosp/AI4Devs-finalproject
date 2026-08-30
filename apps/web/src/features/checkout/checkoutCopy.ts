import type { AppError } from '@/lib/http/errors';

/**
 * Banners del checkout por `AppError.kind` (`design.md` D5, tono §10.2).
 *
 * Constantes, no derivadas de `error.message` crudo — mismo criterio de
 * seguridad que `authCopy.ts` (US-014 D9): el texto de un 409/403 no debe
 * filtrar detalle del backend a la UI.
 */
export const COPY_VALIDATION = 'Revisá los campos marcados.';
export const COPY_CART_EMPTY = 'Tu carrito está vacío.';
export const COPY_CART_NOT_PURCHASABLE = 'Tu carrito cambió, revisalo antes de continuar.';
export const COPY_FORBIDDEN = 'Recargá la página e intentá de nuevo.';
export const COPY_NETWORK = 'No pudimos conectar. Revisá tu conexión y probá de nuevo.';
export const COPY_SERVER = 'Algo salió mal. Probá de nuevo en un momento.';

const PROBLEM_TYPE_CART_EMPTY = 'dsm:checkout/cart-empty';
const PROBLEM_TYPE_CART_NOT_PURCHASABLE = 'dsm:checkout/cart-not-purchasable';

/**
 * AC-10 / D5: si el backend no mandó `Retry-After`, el copy es genérico en vez
 * de inventar un número.
 */
export function copyRateLimited(retryAfterSeconds?: number): string {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) {
    return 'Demasiados intentos. Esperá un momento y probá de nuevo.';
  }
  const minutos = Math.ceil(retryAfterSeconds / 60);
  return retryAfterSeconds < 60
    ? `Demasiados intentos. Probá de nuevo en ${retryAfterSeconds} segundos.`
    : `Demasiados intentos. Probá de nuevo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`;
}

/** Banner + si corresponde link a `/carrito` (D5). */
export interface CheckoutBanner {
  message: string;
  linkToCart: boolean;
}

export function checkoutBannerFor(error: AppError): CheckoutBanner {
  switch (error.kind) {
    case 'validation':
      return { message: COPY_VALIDATION, linkToCart: false };
    case 'conflict':
      if (error.problemType === PROBLEM_TYPE_CART_EMPTY) {
        return { message: COPY_CART_EMPTY, linkToCart: true };
      }
      if (error.problemType === PROBLEM_TYPE_CART_NOT_PURCHASABLE) {
        return { message: COPY_CART_NOT_PURCHASABLE, linkToCart: true };
      }
      return { message: COPY_CART_NOT_PURCHASABLE, linkToCart: true };
    case 'forbidden':
      return { message: COPY_FORBIDDEN, linkToCart: false };
    case 'rateLimited':
      return { message: copyRateLimited(error.retryAfterSeconds), linkToCart: false };
    case 'network':
      return { message: COPY_NETWORK, linkToCart: false };
    default:
      return { message: COPY_SERVER, linkToCart: false };
  }
}
