import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { CartProduct, ProductsRepository } from '../products/products.repository';
import {
  CartTooManyItemsError,
  InsufficientStockError,
} from '../common/errors/cart-errors';
import { NotFoundError } from '../common/errors/domain-errors';
import { CartsRepository, CartWithItems } from './carts.repository';
import { CartTokenService } from './cart-token.service';
import { buildCartView, CartView } from './cart-view';
import { CartEventsService } from '../observability/cart-events.service';

/**
 * Mensaje único de 404: un slug inexistente, uno `draft` y uno `archived`
 * producen **el mismo** error (AC-10). Si se distinguieran, el carrito sería un
 * oráculo de enumeración del catálogo oculto — la misma disciplina que US-003 fijó
 * para la ficha.
 */
const PRODUCTO_NO_ENCONTRADO = 'Producto no encontrado';

/**
 * Casos de uso del carrito del invitado.
 *
 * Tres invariantes gobiernan este archivo:
 *
 * 1. **`products.stock` no se escribe en ningún camino** (AC-8, ADR-0008). El stock
 *    se lee para no dejar pedir más de lo que hay, y se suelta. No se reserva.
 * 2. **Todos los importes se derivan server-side** del precio vigente. El cliente
 *    manda una cantidad y nada más.
 * 3. **El `GET` es seguro**: no crea carrito, no emite cookie, no desliza la
 *    ventana.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly carts: CartsRepository,
    private readonly products: ProductsRepository,
    private readonly cartToken: CartTokenService,
    private readonly config: ConfigService,
    private readonly events: CartEventsService,
  ) {}

  private get maxItems(): number {
    return this.config.get<number>('CART_MAX_ITEMS', 50);
  }

  private get maxQtyPerLine(): number {
    return this.config.get<number>('CART_MAX_QTY_PER_LINE', 99);
  }

  /** `traceparent` del cliente, para correlacionar el evento con la request. */
  private static traceDe(req: Request): string | undefined {
    const traceparent = req.headers?.traceparent;
    return typeof traceparent === 'string' ? traceparent : undefined;
  }

  /**
   * Fija la cantidad **absoluta** de un producto en el carrito (AC-1, AC-2).
   *
   * El orden de los pasos no es casual: producto → stock → carrito. Validar antes
   * de `ensure` es lo que hace que un rechazo **no escriba nada** — ni la línea ni
   * el carrito ni la cookie. Si el carrito se creara primero, un cliente que pide
   * de más se iría con un carrito vacío recién estrenado y una cookie que no pidió.
   */
  async setItem(
    req: Request,
    res: Response,
    slug: string,
    quantity: number,
  ): Promise<CartView> {
    // Sólo publicados: `findPublishedBySlug` devuelve `null` para draft/archived,
    // así que los tres casos colapsan en el mismo 404 (AC-10).
    const product = await this.products.findPublishedBySlug(slug);
    if (!product) throw new NotFoundError(PRODUCTO_NO_ENCONTRADO);

    // AC-5 — tope al stock disponible, sin reservarlo (AC-8).
    if (quantity > product.stock) {
      // Demanda por encima del stock: señal de reposición para el dueño.
      this.events.emit(
        'cart.stock_limit_rejected',
        product.id,
        null,
        CartService.traceDe(req),
      );
      throw new InsufficientStockError(product.stock);
    }

    const session = await this.cartToken.ensure(req, res);

    const esLineaNueva = !session.cart.items.some(
      (item) => item.product_id === product.id,
    );
    if (esLineaNueva) {
      const lineas = await this.carts.countItems(session.cart.id);
      if (lineas >= this.maxItems) {
        throw new CartTooManyItemsError(this.maxItems);
      }
    }

    const cart = await this.carts.upsertItemAndTouch(
      {
        cartId: session.cart.id,
        productId: product.id,
        quantity,
        // Se re-sella la instantánea con el precio vigente: `price_changed`
        // significa «desde que lo tocaste, esto cambió» (Decisión 3).
        unitPriceArsCents: product.price_ars_cents,
      },
      this.cartToken.nextExpiration(),
    );
    this.cartToken.refreshCookies(session, res);

    this.events.emit(
      esLineaNueva ? 'cart.item_added' : 'cart.item_quantity_changed',
      product.id,
      cart.id,
      CartService.traceDe(req),
    );

    return this.render(cart);
  }

  /**
   * Lee el carrito. **Operación segura**: no crea carrito, no emite cookie y no
   * desliza la ventana (`api-standards.md` §3.1).
   *
   * Sin cookie, con una cookie huérfana o con la fila vencida devuelve el carrito
   * **vacío** con 200 (AC-7): «no tengo carrito» es un estado válido del recurso,
   * no un recurso ausente. Y si creara uno al mirar, cualquier crawler dejaría una
   * fila por visita.
   */
  async getCart(req: Request): Promise<CartView> {
    const session = await this.cartToken.resolve(req);
    const { view, products } = await this.renderConProductos(
      session?.cart ?? null,
    );

    if (view.id !== null && view.items.length > 0) {
      const trace = CartService.traceDe(req);
      this.events.emit('cart.viewed', view.id, view.id, trace);

      // AC-6 — una línea bloqueada es una venta que el cliente no puede cerrar:
      // el dueño se entera por acá, no por un reclamo.
      const idPorSlug = new Map(products.map((p) => [p.slug, p.id]));
      for (const item of view.items) {
        if (item.availability === 'available') continue;
        this.events.emit(
          'cart.item_unavailable',
          idPorSlug.get(item.slug) ?? item.slug,
          view.id,
          trace,
        );
      }
    }

    return view;
  }

  /**
   * Quita una línea (AC-3). Idempotente: quitar algo que no está devuelve el
   * carrito igual, sin error — un `DELETE` reintentado por la red no puede fallar.
   *
   * El producto se resuelve **sin filtrar estado**: una línea de un producto
   * archivado (AC-6) tiene que poder sacarse del carrito. Si se resolviera con el
   * filtro de publicados, el cliente quedaría con una línea bloqueada e
   * imposible de quitar.
   */
  async removeItem(
    req: Request,
    res: Response,
    slug: string,
  ): Promise<CartView> {
    const session = await this.cartToken.resolve(req);
    if (!session) return this.render(null);

    const [product] = await this.products.findManyBySlugs([slug]);
    const tieneLinea =
      product !== undefined &&
      session.cart.items.some((item) => item.product_id === product.id);
    // Nada que borrar: se devuelve el carrito tal cual y no se desliza la ventana
    // (no hubo actividad sobre el carrito).
    if (!tieneLinea) return this.render(session.cart);

    const { cart } = await this.carts.deleteItemAndTouch(
      session.cart.id,
      product.id,
      this.cartToken.nextExpiration(),
    );
    this.cartToken.refreshCookies(session, res);

    this.events.emit(
      'cart.item_removed',
      product.id,
      cart.id,
      CartService.traceDe(req),
    );

    return this.render(cart);
  }

  /** Arma la vista con los precios vigentes leídos en ESTA request (AC-9). */
  private async render(cart: CartWithItems | null): Promise<CartView> {
    return (await this.renderConProductos(cart)).view;
  }

  /**
   * Igual que `render` pero devolviendo también los productos leídos: la lectura
   * necesita el `product.id` de las líneas bloqueadas para el evento de negocio, y
   * la vista sólo expone el `slug`.
   */
  private async renderConProductos(
    cart: CartWithItems | null,
  ): Promise<{ view: CartView; products: CartProduct[] }> {
    const limits = { maxQtyPerLine: this.maxQtyPerLine };
    if (!cart) return { view: buildCartView(null, [], limits), products: [] };

    const products: CartProduct[] = await this.products.findManyByIds(
      cart.items.map((item) => item.product_id),
    );
    return { view: buildCartView(cart, products, limits), products };
  }
}
