import { DomainError, FieldError } from '../common/errors/domain-errors';

/**
 * Errores de dominio del checkout (§6). Los mapea el `HttpProblemFilter` existente
 * al envelope RFC 7807, igual que los de catálogo/auth/carrito — por eso extienden
 * `DomainError` y no traen nada de NestJS.
 *
 * El catálogo es **cerrado**: junto con el 422 del `ValidationPipe` y el 429 del
 * throttler propio, estos son todos los `type` que la superficie del checkout
 * puede devolver, y el contrato OpenAPI (T6.1) los declara uno por uno.
 */

/** 409 — el carrito de la cookie no existe, venció, o quedó sin líneas (AC-5). */
export class CartEmptyError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:checkout/cart-empty';

  constructor() {
    super('El carrito está vacío o no existe');
  }
}

/**
 * 409 — el carrito tiene una o más líneas que bloquean la compra (despublicadas
 * o sin stock, `has_blocking_issues` de `buildCartView`, AC-5).
 *
 * Trae `fieldErrors` con **una entrada por línea que molesta**: `field` es el
 * slug del producto y `message` el motivo, para que el frontend pueda señalar
 * exactamente qué línea sacar del carrito en vez de un «no se puede» sin datos.
 */
export class CartNotPurchasableError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:checkout/cart-not-purchasable';

  constructor(fieldErrors: FieldError[]) {
    super('El carrito tiene productos que ya no se pueden comprar', fieldErrors);
  }
}
