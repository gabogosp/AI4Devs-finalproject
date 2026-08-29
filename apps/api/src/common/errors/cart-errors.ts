import { DomainError } from './domain-errors';

/**
 * Errores de dominio del carrito (§6). Los mapea el `HttpProblemFilter` existente
 * al envelope RFC 7807, igual que los de catálogo y auth — por eso extienden
 * `DomainError` y no traen nada de NestJS.
 *
 * El catálogo es **cerrado**: junto con `NotFoundError` (404, producto inexistente
 * **o** no publicado — el mismo para los dos, AC-10), `CsrfError` (403), el 422 del
 * `ValidationPipe` y el 429 del throttler, estos son todos los `type` que la
 * superficie del carrito puede devolver, y el contrato OpenAPI (T7.1) los declara
 * uno por uno.
 *
 * Los dos usan **extension members** (RFC 7807 §3.2) para que el número que el
 * frontend necesita viaje como número. La alternativa —meterlo en el `detail` y
 * que el FE lo saque con una regex— rompe al primer cambio de redacción.
 *
 * Ningún mensaje de acá contiene el token del carrito: el `detail` va al cliente y
 * a los logs de error.
 */

/**
 * 409 — se pidió más de lo que hay en stock (AC-5).
 *
 * Es rechazo y no recorte silencioso: AC-5 dice «no permite superar el stock
 * disponible», y recortar la cantidad sin avisar entrega un carrito distinto del
 * que el cliente pidió. Con `available_quantity` el FE puede poner el tope en el
 * stepper y explicar por qué.
 *
 * **No** reserva ni descuenta nada: el stock se lee, se compara y se suelta
 * (ADR-0008, AC-8).
 */
export class InsufficientStockError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:cart/insufficient-stock';

  constructor(availableQuantity: number) {
    super(
      'No hay stock suficiente para la cantidad pedida',
      undefined,
      { available_quantity: availableQuantity },
    );
  }
}

/**
 * 409 — el carrito ya tiene `CART_MAX_ITEMS` líneas distintas.
 *
 * Es una cota anti-DoS (§7.3): un carrito de 10.000 líneas convierte cada `GET`
 * en una consulta y una respuesta enormes. `max_items` le dice al FE cuál es el
 * techo en vez de dejarlo adivinar.
 */
export class CartTooManyItemsError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:cart/too-many-items';

  constructor(maxItems: number) {
    super(
      'El carrito alcanzó el máximo de productos distintos',
      undefined,
      { max_items: maxItems },
    );
  }
}
