import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { normalizeEmail } from '../auth/email/normalize-email';
import { CartTokenService } from '../cart/cart-token.service';
import { buildCartView } from '../cart/cart-view';
import { CartProduct, ProductsRepository } from '../products/products.repository';
import { FieldError } from '../common/errors/domain-errors';
import { CartEmptyError, CartNotPurchasableError } from './checkout-errors';
import { buildOrderDraft } from './order-draft';
import { OrderTokenService } from './order-token.service';
import { OrdersRepository } from './orders.repository';

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
  constructor(
    private readonly cartToken: CartTokenService,
    private readonly products: ProductsRepository,
    private readonly orders: OrdersRepository,
    private readonly orderToken: OrderTokenService,
    private readonly config: ConfigService,
  ) {}

  private get maxQtyPerLine(): number {
    return this.config.get<number>('CART_MAX_QTY_PER_LINE', 99);
  }

  private get legalTermsVersion(): string {
    return this.config.getOrThrow<string>('LEGAL_TERMS_VERSION');
  }

  async createOrder(req: Request, input: CreateOrderInput): Promise<CreatedOrder> {
    const session = await this.cartToken.resolve(req);
    if (!session || session.cart.items.length === 0) {
      throw new CartEmptyError();
    }

    const cartProducts: CartProduct[] = await this.products.findManyByIds(
      session.cart.items.map((item) => item.product_id),
    );
    const view = buildCartView(session.cart, cartProducts, {
      maxQtyPerLine: this.maxQtyPerLine,
    });

    if (view.items.length === 0) throw new CartEmptyError();
    if (view.has_blocking_issues) {
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

    return {
      orderToken: token,
      orderNumber: orden.order_number,
      status: orden.status,
      totalArsCents: orden.total_ars_cents,
      itemsCount: orden.items.length,
    };
  }
}
