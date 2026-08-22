import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parseCorsOrigins } from '../src/config/env.validation';
import { PrismaService } from '../src/prisma/prisma.service';
import { nuevaIpDeTest } from './e2e-app';

/**
 * Cliente HTTP de la superficie del carrito para los e2e.
 *
 * Maneja las cookies **a mano** (en vez de usar `request.agent`) a propósito: los
 * casos de US-007 necesitan control explícito sobre qué cookie viaja — volver «en
 * otra visita» llevando sólo `dsm_cart`, presentar el CSRF de otro carrito, o
 * mandar una escritura sin `Origin`. Con un jar automático eso no se puede
 * expresar.
 *
 * También resuelve el double-submit: aprende `dsm_cart_csrf` de cada respuesta y
 * lo reenvía como `X-CSRF-Token`, que es exactamente lo que hace el frontend.
 */
export interface RespuestaHttp {
  status: number;
  body: Record<string, never> & { cart?: CarritoRespuesta } & Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

export interface ItemRespuesta {
  slug: string;
  name: string;
  image_url: string | null;
  quantity: number;
  unit_price_ars_cents: number;
  currency: string;
  subtotal_ars_cents: number;
  availability: 'available' | 'insufficient_stock' | 'unavailable';
  available_quantity?: number;
  max_quantity: number;
  price_changed: boolean;
  previous_unit_price_ars_cents?: number;
}

export interface CarritoRespuesta {
  id: string | null;
  items: ItemRespuesta[];
  item_count: number;
  total_quantity: number;
  total_ars_cents: number;
  has_blocking_issues: boolean;
  updated_at: string | null;
}

export interface OpcionesDePeticion {
  /** `null` para NO mandar el header (caso de rechazo por Origin ausente). */
  origin?: string | null;
  /** `null` para NO mandar el double-submit; string para mandar uno concreto. */
  csrf?: string | null;
}

export const ORIGEN_PERMITIDO =
  parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS ?? '')[0] ??
  'http://localhost:3200';

export class ClienteDeCarrito {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly app: INestApplication,
    readonly ip: string = nuevaIpDeTest(),
    private readonly origenPorDefecto: string | null = ORIGEN_PERMITIDO,
  ) {}

  /** Valor de una cookie del cliente (`dsm_cart`, `dsm_cart_csrf`). */
  cookie(nombre: string): string | undefined {
    return this.cookies.get(nombre);
  }

  /** Fija cookies a mano — simula «volver» con lo que quedó en el navegador. */
  conCookies(pares: Record<string, string>): this {
    for (const [nombre, valor] of Object.entries(pares)) {
      this.cookies.set(nombre, valor);
    }
    return this;
  }

  private header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()]
      .map(([nombre, valor]) => `${nombre}=${valor}`)
      .join('; ');
  }

  /** Aprende las cookies de la respuesta, incluidas las que se borran. */
  private aprender(res: { headers: Record<string, unknown> }): void {
    const emitidas = res.headers['set-cookie'] as string[] | undefined;
    if (!emitidas) return;
    for (const cookie of emitidas) {
      const [par, ...atributos] = cookie.split(';');
      const indice = par.indexOf('=');
      const nombre = par.slice(0, indice);
      const valor = par.slice(indice + 1);
      const borrada = atributos.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a));
      if (borrada) this.cookies.delete(nombre);
      else this.cookies.set(nombre, valor);
    }
  }

  private async ejecutar(
    peticion: request.Test,
    opts: OpcionesDePeticion,
    conCsrf: boolean,
  ): Promise<RespuestaHttp> {
    peticion.set('X-Forwarded-For', this.ip);

    const cookies = this.header();
    if (cookies) peticion.set('Cookie', cookies);

    const origen = opts.origin === undefined ? this.origenPorDefecto : opts.origin;
    if (origen !== null) peticion.set('Origin', origen);

    if (conCsrf) {
      const csrf =
        opts.csrf === undefined ? this.cookies.get('dsm_cart_csrf') : opts.csrf;
      if (typeof csrf === 'string') peticion.set('X-CSRF-Token', csrf);
    }

    const res = await peticion;
    this.aprender(res as unknown as { headers: Record<string, unknown> });
    return res as unknown as RespuestaHttp;
  }

  get(opts: OpcionesDePeticion = {}): Promise<RespuestaHttp> {
    return this.ejecutar(
      request(this.app.getHttpServer()).get('/v1/cart'),
      opts,
      false,
    );
  }

  put(
    slug: string,
    body: unknown,
    opts: OpcionesDePeticion = {},
  ): Promise<RespuestaHttp> {
    return this.ejecutar(
      request(this.app.getHttpServer())
        .put(`/v1/cart/items/${slug}`)
        .send(body as object),
      opts,
      true,
    );
  }

  del(slug: string, opts: OpcionesDePeticion = {}): Promise<RespuestaHttp> {
    return this.ejecutar(
      request(this.app.getHttpServer()).delete(`/v1/cart/items/${slug}`),
      opts,
      true,
    );
  }
}

/** Vacía carrito + catálogo para tests deterministas. */
export async function truncarCarrito(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE carts, cart_items, products, categories RESTART IDENTITY CASCADE',
  );
}

export interface ProductoSembrado {
  slug: string;
  price: number;
  stock?: number;
  status?: string;
  name?: string;
}

/** Siembra una categoría y los productos pedidos. Devuelve los ids por slug. */
export async function sembrarProductos(
  prisma: PrismaService,
  productos: ProductoSembrado[],
): Promise<Record<string, string>> {
  const categoria = await prisma.category.create({
    data: { name: 'Fijaciones', slug: 'fijaciones' },
  });
  const ids: Record<string, string> = {};
  for (const p of productos) {
    const creado = await prisma.product.create({
      data: {
        sku: p.slug.toUpperCase(),
        slug: p.slug,
        name: p.name ?? p.slug,
        price_ars_cents: p.price,
        stock: p.stock ?? 10,
        status: p.status ?? 'published',
        category_id: categoria.id,
      },
    });
    ids[creado.slug] = creado.id;
  }
  return ids;
}
