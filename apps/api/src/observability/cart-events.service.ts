import { Injectable, Logger } from '@nestjs/common';

export type CartEventName =
  | 'cart.item_added'
  | 'cart.item_quantity_changed'
  | 'cart.item_removed'
  | 'cart.viewed'
  | 'cart.stock_limit_rejected'
  | 'cart.item_unavailable';

/**
 * Eventos de negocio del carrito (US §9, E2E §18).
 *
 * Espejo de `CatalogEventsService` y `AuthEventsService`: contador en memoria +
 * log pino estructurado. Tres reglas propias:
 *
 * 1. **El token del carrito no se loguea nunca**, ni en claro ni hasheado. Es la
 *    credencial de acceso al carrito: un log con el token es un log con la sesión
 *    de compra de la persona. Al log va el `cart_id`, que no da acceso.
 * 2. **El `cart_id` va al log, jamás como dimensión del contador**
 *    (`observability-patterns` §3.3). Una etiqueta por carrito hace explotar la
 *    cardinalidad de la métrica.
 * 3. **Sin PII**: en esta US no hay datos de comprador (llegan en US-008 con el
 *    checkout), así que no hay nada que filtrar — y no se agrega nada.
 *
 * `cart.item_added` es el insumo directo del embudo de conversión de US-016, y
 * `cart.stock_limit_rejected` es la señal de **demanda por encima del stock**: le
 * dice al dueño qué reponer, dato que hoy el negocio no tiene de ninguna forma.
 */
@Injectable()
export class CartEventsService {
  private readonly logger = new Logger(CartEventsService.name);
  private readonly counters = new Map<CartEventName, number>();

  /**
   * @param entityId `product.id` en los eventos de línea, `cart.id` en
   * `cart.viewed` (ver la tabla de `design.md` §Observabilidad).
   * @param cartId UUID del carrito, sólo para el log.
   */
  emit(
    name: CartEventName,
    entityId: string,
    cartId: string | null = null,
    traceId?: string,
  ): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    this.logger.log({
      event: name,
      entity_id: entityId,
      cart_id: cartId,
      trace_id: traceId,
    });
  }

  /** Valor del contador (stand-in de una métrica Prometheus). */
  count(name: CartEventName): number {
    return this.counters.get(name) ?? 0;
  }

  /** Sólo para tests: reinicia los contadores. */
  reset(): void {
    this.counters.clear();
  }
}
