import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ClienteDeCarrito, ORIGEN_PERMITIDO, RespuestaHttp } from './cart-client';

/**
 * Cliente HTTP del checkout para los e2e — compone `ClienteDeCarrito`: el
 * checkout se autoriza con la MISMA cookie `dsm_cart` y el MISMO double-submit
 * `dsm_cart_csrf` (T3.2 reusa `CartCsrfGuard` tal cual).
 */
export class ClienteDeCheckout {
  constructor(
    private readonly app: INestApplication,
    private readonly cliente: ClienteDeCarrito,
  ) {}

  get ip(): string {
    return this.cliente.ip;
  }

  cookie(nombre: string): string | undefined {
    return this.cliente.cookie(nombre);
  }

  async post(
    body: unknown,
    opts: { origin?: string | null; csrf?: string | null } = {},
  ): Promise<RespuestaHttp> {
    const req = request(this.app.getHttpServer())
      .post('/v1/checkout')
      .send(body as object)
      .set('X-Forwarded-For', this.cliente.ip);

    const cookieHeader = [
      this.cliente.cookie('dsm_cart') && `dsm_cart=${this.cliente.cookie('dsm_cart')}`,
    ]
      .filter(Boolean)
      .join('; ');
    if (cookieHeader) req.set('Cookie', cookieHeader);

    const origen = opts.origin === undefined ? ORIGEN_PERMITIDO : opts.origin;
    if (origen !== null) req.set('Origin', origen);

    const csrf =
      opts.csrf === undefined ? this.cliente.cookie('dsm_cart_csrf') : opts.csrf;
    if (typeof csrf === 'string') req.set('X-CSRF-Token', csrf);

    const res = await req;
    return res as unknown as RespuestaHttp;
  }
}
