import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { normalizeEmail } from '../auth/email/normalize-email';
import { RequestConCliente } from '../auth/customer.guard';
import { CartTokenService } from '../cart/cart-token.service';
import { buildCartView } from '../cart/cart-view';
import { CartProduct, ProductsRepository } from '../products/products.repository';
import { FieldError } from '../common/errors/domain-errors';
import { CheckoutEventsService } from '../observability/checkout-events.service';
import { CartEmptyError, CartNotPurchasableError } from './checkout-errors';
import { buildOrderDraft } from './order-draft';
import { OrderTokenService } from './order-token.service';
import { OrdersRepository, OrderWithItems } from './orders.repository';
import { NOTIFICATION_PORT, NotificationPort } from '../orders/ports/notification.port';

export interface CreateOrderInput {
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
}

export interface CreatedOrder {
  orderToken: string;
  orderNumber: number;
  status: string;
  totalArsCents: number;
  itemsCount: number;
}

/** Motivo por línea que el 409 de `CartNotPurchasableError` reporta (AC-5). */
function motivoDeBloqueo(availability: 'insufficient_stock' | 'unavailable'): string {
  return availability === 'insufficient_stock'
    ? 'sin stock suficiente'
    : 'despublicado';
}

/**
 * Caso de uso del checkout (T2.3) — `backend-node-standards.md` §5.
 *
 * Resuelve el carrito, lee los productos **vigentes** y construye la vista con
 * `buildCartView` (US-007, reusada — design.md §Trade-offs), igual que
 * `CartService.getCart`: la lectura pasa **justo antes** de la escritura, sin
 * ventana de tiempo de usuario en el medio (a diferencia del carrito, que
 * persiste entre visitas). `OrdersRepository.createPendingOrder` es la única
 * transacción — el snapshot es del precio que esa transacción escribió.
 *
 * **Ninguna escritura sobre `products` ni sobre `carts`/`cart_items`** en
 * ningún camino: el checkout no vacía el carrito (OQ-BE-3) ni descuenta stock
 * (AC-6, ADR-0008).
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly cartToken: CartTokenService,
    private readonly products: ProductsRepository,
    private readonly orders: OrdersRepository,
    private readonly orderToken: OrderTokenService,
    private readonly config: ConfigService,
    private readonly events: CheckoutEventsService,
    @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
  ) {}

  private get maxQtyPerLine(): number {
    return this.config.get<number>('CART_MAX_QTY_PER_LINE', 99);
  }

  private get legalTermsVersion(): string {
    return this.config.getOrThrow<string>('LEGAL_TERMS_VERSION');
  }

  /** `traceparent` del cliente, para correlacionar el evento con la request. */
  private static traceDe(req: Request): string | undefined {
    const traceparent = req.headers?.traceparent;
    return typeof traceparent === 'string' ? traceparent : undefined;
  }

  /**
   * `req.customerId` (US-015, design.md §D2) — mismo patrón que `traceDe`:
   * el service lee `req` crudo, ya lo hacía. `OptionalCustomerGuard` es la
   * única autoridad que decide si un JWT de cliente es válido; acá sólo se
   * lee lo que el guard ya dejó. `undefined` cuando no hay sesión — el
   * checkout sigue siendo guest-first, exactamente el comportamiento actual.
   */
  private static customerIdDe(req: Request): string | undefined {
    return (req as RequestConCliente).customerId;
  }

  async createOrder(req: Request, input: CreateOrderInput): Promise<CreatedOrder> {
    const trace = CheckoutService.traceDe(req);
    const customerId = CheckoutService.customerIdDe(req);
    const session = await this.cartToken.resolve(req);
    if (!session || session.cart.items.length === 0) {
      this.events.emit('checkout.rejected_empty_cart', null, trace);
      throw new CartEmptyError();
    }

    const cartProducts: CartProduct[] = await this.products.findManyByIds(
      session.cart.items.map((item) => item.product_id),
    );
    const view = buildCartView(session.cart, cartProducts, {
      maxQtyPerLine: this.maxQtyPerLine,
    });

    if (view.items.length === 0) {
      this.events.emit('checkout.rejected_empty_cart', null, trace);
      throw new CartEmptyError();
    }
    if (view.has_blocking_issues) {
      this.events.emit('checkout.rejected_blocking_issues', null, trace);
      const fieldErrors: FieldError[] = view.items
        .filter((item) => item.availability !== 'available')
        .map((item) => ({
          field: item.slug,
          message: motivoDeBloqueo(
            item.availability as 'insufficient_stock' | 'unavailable',
          ),
        }));
      throw new CartNotPurchasableError(fieldErrors);
    }

    const draft = buildOrderDraft(
      view,
      cartProducts.map((p) => ({ slug: p.slug, id: p.id, sku: p.sku })),
    );
    const { token, tokenHash } = this.orderToken.issue();

    const orden = await this.orders.createPendingOrder({
      accessTokenHash: tokenHash,
      customerId,
      buyerName: input.buyerName,
      buyerEmail: normalizeEmail(input.buyerEmail),
      buyerPhone: input.buyerPhone,
      totalArsCents: draft.totalArsCents,
      consentAcceptedAt: new Date(),
      consentTermsVersion: this.legalTermsVersion,
      lines: draft.lines.map((linea) => ({
        productId: linea.product_id,
        quantity: linea.quantity,
        unitPriceArsCents: linea.unit_price_ars_cents,
        productName: linea.product_name,
        productSku: linea.product_sku,
      })),
    });

    this.events.emit('checkout.order_created', orden.id, trace);
    this.notificarOrdenRecibida(orden);

    return {
      orderToken: token,
      orderNumber: orden.order_number,
      status: orden.status,
      totalArsCents: orden.total_ars_cents,
      itemsCount: orden.items.length,
    };
  }

  /**
   * Resumen de compra al cliente + aviso al dueño, al crear la orden
   * (`pending_payment`) — el punto de disparo real hoy: MercadoPago está
   * diferido, así que `orderConfirmed`/`ownerNewOrder` (pago confirmado,
   * `ConfirmOrderService`) nunca corren para la rama `manual`, que es la
   * única que existe en producción (WhatsApp handoff).
   *
   * Best-effort, SIN `await` a propósito — a diferencia de
   * `ConfirmOrderService.notificarConfirmacion` (que sí espera al puerto):
   * acá hay una persona esperando la respuesta del checkout en el navegador,
   * el path más sensible a latencia de todo el back — un Resend lento (hasta
   * `RESEND_TIMEOUT_MS` × reintentos) no puede sumarse al tiempo de compra.
   * Un webhook de pago no tiene ese apuro. `NotificationPort` ya no propaga
   * (`ResendNotificationAdapter`/`LoggingNotificationAdapter`); el `catch` es
   * defensa en profundidad.
   */
  private notificarOrdenRecibida(orden: OrderWithItems): void {
    const items = orden.items.map((item) => ({
      productName: item.product_name,
      quantity: item.quantity,
      unitPriceArsCents: item.unit_price_ars_cents,
    }));

    this.notifications
      .orderReceived({
        orderId: orden.id,
        orderNumber: orden.order_number,
        buyerName: orden.buyer_name,
        buyerEmail: orden.buyer_email,
        items,
        totalArsCents: orden.total_ars_cents,
      })
      .catch((error) =>
        this.logger.error(
          `order_received.trigger_failed order_id=${orden.id}: ${(error as Error).message}`,
        ),
      );

    this.notifications
      .ownerOrderReceived({
        orderId: orden.id,
        orderNumber: orden.order_number,
        totalArsCents: orden.total_ars_cents,
      })
      .catch((error) =>
        this.logger.error(
          `owner_order_received.trigger_failed order_id=${orden.id}: ${(error as Error).message}`,
        ),
      );
  }
}
