import { Injectable } from '@nestjs/common';
import { Cart, CartItem } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError, ValidationError } from '../common/errors/domain-errors';
import {
  isPrismaError,
  PRISMA_FK_VIOLATION,
  PRISMA_RECORD_NOT_FOUND,
} from '../common/prisma-errors';

export interface CreateCartData {
  tokenHash: string;
  expiresAt: Date;
}

export interface UpsertItemData {
  cartId: string;
  productId: string;
  quantity: number;
  unitPriceArsCents: number;
}

/** Carrito con sus líneas — la forma en que lo consume el service. */
export type CartWithItems = Cart & { items: CartItem[] };

/**
 * Único punto de ORM para `carts` + `cart_items` (§5). Ningún service toca
 * `PrismaService` directamente, y ningún error crudo de Prisma escapa de acá: se
 * traducen a errores de dominio (§6) que el filtro RFC 7807 ya sabe mapear.
 *
 * Nada acá acepta ni devuelve el token del carrito en claro: sólo su hash. El
 * claro vive en la cookie del cliente y en la variable local que lo generó.
 */
@Injectable()
export class CartsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Carrito **vivo** por hash del token, con sus líneas.
   *
   * El filtro por `expires_at` va en la query y no en el service: si un camino
   * olvidara chequearlo, un carrito vencido volvería a la vida. Devuelve `null`
   * tanto si la fila no existe como si venció — quien llama no necesita
   * distinguirlo y el borde no debe filtrar el motivo.
   */
  findLiveByTokenHash(tokenHash: string): Promise<CartWithItems | null> {
    return this.prisma.cart.findFirst({
      where: { session_token_hash: tokenHash, expires_at: { gt: new Date() } },
      include: { items: true },
    });
  }

  /** Igual que el anterior pero sin filtrar por vencimiento — lo usa la purga. */
  findByTokenHash(tokenHash: string): Promise<CartWithItems | null> {
    return this.prisma.cart.findUnique({
      where: { session_token_hash: tokenHash },
      include: { items: true },
    });
  }

  create(data: CreateCartData): Promise<Cart> {
    return this.prisma.cart.create({
      data: { session_token_hash: data.tokenHash, expires_at: data.expiresAt },
    });
  }

  /** Borra el carrito; la FK `ON DELETE CASCADE` se lleva sus líneas. */
  async deleteById(id: string): Promise<void> {
    try {
      await this.prisma.cart.delete({ where: { id } });
    } catch (error) {
      // Ya no estaba: para el llamador el efecto es el mismo (no hay carrito).
      if (isPrismaError(error, PRISMA_RECORD_NOT_FOUND)) return;
      throw error;
    }
  }

  /**
   * Fija la línea de un producto: la crea o actualiza su cantidad e instantánea
   * de precio.
   *
   * Va sobre la clave compuesta única `(cart_id, product_id)` y no con un
   * `findFirst` + `if`: dos requests en paralelo con ese patrón crean dos filas
   * del mismo producto. Acá lo impide la base, no el orden de ejecución.
   */
  async upsertItem(data: UpsertItemData): Promise<CartItem> {
    try {
      return await this.prisma.cartItem.upsert({
        where: {
          cart_id_product_id: {
            cart_id: data.cartId,
            product_id: data.productId,
          },
        },
        create: {
          cart_id: data.cartId,
          product_id: data.productId,
          quantity: data.quantity,
          unit_price_ars_cents: data.unitPriceArsCents,
        },
        update: {
          quantity: data.quantity,
          unit_price_ars_cents: data.unitPriceArsCents,
        },
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** Quita la línea. Idempotente: si no estaba, no pasa nada. */
  async deleteItem(cartId: string, productId: string): Promise<boolean> {
    const { count } = await this.prisma.cartItem.deleteMany({
      where: { cart_id: cartId, product_id: productId },
    });
    return count > 0;
  }

  /**
   * Fija la línea **y** desliza la ventana en una sola transacción, devolviendo el
   * carrito ya recargado.
   *
   * Las dos escrituras van juntas (§5 — transacción para casos de uso
   * multi-escritura): una línea agregada con la ventana sin deslizar deja un
   * carrito que el cliente acaba de tocar y que vence antes de lo que debería.
   */
  async upsertItemAndTouch(
    data: UpsertItemData,
    expiresAt: Date,
  ): Promise<CartWithItems> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.cartItem.upsert({
          where: {
            cart_id_product_id: {
              cart_id: data.cartId,
              product_id: data.productId,
            },
          },
          create: {
            cart_id: data.cartId,
            product_id: data.productId,
            quantity: data.quantity,
            unit_price_ars_cents: data.unitPriceArsCents,
          },
          update: {
            quantity: data.quantity,
            unit_price_ars_cents: data.unitPriceArsCents,
          },
        });
        return await tx.cart.update({
          where: { id: data.cartId },
          data: { expires_at: expiresAt },
          include: { items: true },
        });
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  /**
   * Quita la línea **y** desliza la ventana en una sola transacción. Devuelve el
   * carrito recargado y si había algo que borrar (para el evento de negocio).
   */
  async deleteItemAndTouch(
    cartId: string,
    productId: string,
    expiresAt: Date,
  ): Promise<{ cart: CartWithItems; removed: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.cartItem.deleteMany({
          where: { cart_id: cartId, product_id: productId },
        });
        const cart = await tx.cart.update({
          where: { id: cartId },
          data: { expires_at: expiresAt },
          include: { items: true },
        });
        return { cart, removed: count > 0 };
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** Líneas distintas del carrito (no unidades) — insumo de `CART_MAX_ITEMS`. */
  countItems(cartId: string): Promise<number> {
    return this.prisma.cartItem.count({ where: { cart_id: cartId } });
  }

  /**
   * Desliza la ventana de retención. Sólo lo llaman las **escrituras**: en `GET`
   * escribiría en base en cada lectura y volvería mutante una operación segura.
   */
  async touch(cartId: string, expiresAt: Date): Promise<Cart> {
    try {
      return await this.prisma.cart.update({
        where: { id: cartId },
        data: { expires_at: expiresAt },
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** Purga por vencimiento. Devuelve cuántas filas se borraron. */
  async deleteExpired(): Promise<number> {
    const { count } = await this.prisma.cart.deleteMany({
      where: { expires_at: { lte: new Date() } },
    });
    return count;
  }

  private translate(error: unknown): unknown {
    if (isPrismaError(error, PRISMA_FK_VIOLATION)) {
      // El carrito o el producto referenciado no existe (carrera con una purga o
      // con un borrado). No es un 500: es un input que ya no es válido.
      return new ValidationError('El carrito o el producto ya no existe');
    }
    if (isPrismaError(error, PRISMA_RECORD_NOT_FOUND)) {
      return new NotFoundError('Carrito no encontrado');
    }
    return error;
  }
}
