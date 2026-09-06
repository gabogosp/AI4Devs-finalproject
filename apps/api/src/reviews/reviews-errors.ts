import { DomainError } from '../common/errors/domain-errors';

/**
 * 403 — el cliente nunca compró el producto en una orden `delivered`
 * (US-025 AC-6). Se verifica SIEMPRE server-side antes de escribir
 * `reviews` (NFR §9 de la US) — nunca se confía en que el FE oculte el
 * control.
 */
export class ReviewNotEligibleError extends DomainError {
  readonly status = 403;
  readonly type = 'dsm:reviews/not-eligible';

  constructor() {
    super('Sólo se puede reseñar un producto comprado y entregado');
  }
}
