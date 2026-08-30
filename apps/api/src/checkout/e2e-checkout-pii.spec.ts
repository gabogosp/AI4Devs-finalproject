import { INestApplication, Logger } from '@nestjs/common';
import { bootTestApp } from '../../test/e2e-app';
import { ClienteDeCarrito, sembrarProductos } from '../../test/cart-client';
import { ClienteDeCheckout } from '../../test/checkout-client';
import { PrismaService } from '../prisma/prisma.service';
import { CartModule } from '../cart/cart.module';
import { CheckoutModule } from './checkout.module';

/**
 * T4.2 — la PII del comprador no sale por ningún canal (`observability-standards.md`
 * §9, `api-standards.md` §8.6).
 *
 * Tres centinelas sembrados a propósito (nombre, email, teléfono) + el `order_token`
 * en claro. Se capturan **todas** las llamadas al logger (`Logger.prototype.log/
 * error/warn/debug`, que es lo que usan `CheckoutEventsService` y cualquier otro
 * servicio de la app) y se serializan los 5 cuerpos de respuesta. Ninguno de los 4
 * valores puede aparecer en ninguno de los dos.
 */
describe('PII del checkout (e2e-checkout-pii)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const CENTINELA_NOMBRE = 'Comprador Centinela';
  const CENTINELA_EMAIL = 'centinela@ejemplo.test';
  const CENTINELA_TELEFONO = '+54 9 11 0000 0001';

  let capturado: unknown[];
  let restoreLog: jest.SpyInstance;
  let restoreError: jest.SpyInstance;
  let restoreWarn: jest.SpyInstance;
  let restoreDebug: jest.SpyInstance;

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([CartModule, CheckoutModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, carts, cart_items, products, categories RESTART IDENTITY CASCADE',
    );
    await sembrarProductos(prisma, [
      { slug: 'compresor-embraco', price: 12_500_000, stock: 1 },
      { slug: 'gas-r134a', price: 850_000, stock: 1000 },
    ]);

    capturado = [];
    const registrar = (p: unknown) => void capturado.push(p);
    restoreLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(registrar);
    restoreError = jest.spyOn(Logger.prototype, 'error').mockImplementation(registrar);
    restoreWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(registrar);
    restoreDebug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(registrar);
  });
  afterEach(() => {
    restoreLog.mockRestore();
    restoreError.mockRestore();
    restoreWarn.mockRestore();
    restoreDebug.mockRestore();
  });

  const buyerCentinela = () => ({
    buyer: {
      name: CENTINELA_NOMBRE,
      email: CENTINELA_EMAIL,
      phone: CENTINELA_TELEFONO,
    },
    consent: true,
    fulfillment: 'pickup' as const,
  });

  async function clienteConCarrito(slug: string, quantity = 1): Promise<ClienteDeCheckout> {
    const carrito = new ClienteDeCarrito(app);
    await carrito.put(slug, { quantity });
    return new ClienteDeCheckout(app, carrito);
  }

  /**
   * Todo lo capturado + el cuerpo/headers de las respuestas, en un solo string.
   *
   * **Sólo** `body` y `headers` — nunca el objeto de respuesta de supertest
   * completo: éste trae `req` (lo que el CLIENTE mandó, ecoado por la librería
   * para debug), y buscar el centinela ahí probaría que el test lo mandó, no
   * que el SERVIDOR lo filtró.
   */
  function todoElRastro(respuestas: Array<{ body: unknown; headers: unknown }>): string {
    const soloServidor = respuestas.map((r) => ({ body: r.body, headers: r.headers }));
    return JSON.stringify({ logs: capturado, respuestas: soloServidor });
  }

  it('happy path: ningún centinela ni el order_token aparecen en logs ni en el 201', async () => {
    const cliente = await clienteConCarrito('compresor-embraco');
    const res = await cliente.post(buyerCentinela());
    expect(res.status).toBe(201);

    const rastro = todoElRastro([res]);
    expect(rastro).not.toContain(CENTINELA_NOMBRE);
    expect(rastro).not.toContain(CENTINELA_EMAIL);
    // El log NO tiene el teléfono; el 201 tampoco lo devuelve (T3.1: la
    // respuesta declara sólo order_token/order_number/status/total/items_count).
    expect(rastro).not.toContain(CENTINELA_TELEFONO);
    // El order_token SÍ va en el 201 (su único destino legítimo) — se verifica
    // por separado que NO está en ninguna línea de LOG.
    const soloLogs = JSON.stringify(capturado);
    expect(soloLogs).not.toContain(res.body.order_token);
  });

  it('carrito vacío (409 CartEmptyError): ningún centinela en logs ni en el error', async () => {
    const carrito = new ClienteDeCarrito(app);
    // Nunca se agrega nada: el carrito queda vacío.
    const cliente = new ClienteDeCheckout(app, carrito);
    const res = await cliente.post(buyerCentinela());
    expect(res.status).toBe(409);

    const rastro = todoElRastro([res]);
    expect(rastro).not.toContain(CENTINELA_NOMBRE);
    expect(rastro).not.toContain(CENTINELA_EMAIL);
    expect(rastro).not.toContain(CENTINELA_TELEFONO);
  });

  it('carrito con línea bloqueada (409 CartNotPurchasableError): ningún centinela', async () => {
    const cliente = await clienteConCarrito('compresor-embraco', 1);
    await prisma.product.update({
      where: { slug: 'compresor-embraco' },
      data: { stock: 0 },
    });

    const res = await cliente.post(buyerCentinela());
    expect(res.status).toBe(409);

    const rastro = todoElRastro([res]);
    expect(rastro).not.toContain(CENTINELA_NOMBRE);
    expect(rastro).not.toContain(CENTINELA_EMAIL);
    expect(rastro).not.toContain(CENTINELA_TELEFONO);
  });

  it('consentimiento ausente (422): ningún centinela', async () => {
    const cliente = await clienteConCarrito('gas-r134a');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se descarta a propósito
    const { consent: _consent, ...sinConsent } = buyerCentinela();
    const res = await cliente.post(sinConsent);
    expect(res.status).toBe(422);

    const rastro = todoElRastro([res]);
    expect(rastro).not.toContain(CENTINELA_NOMBRE);
    expect(rastro).not.toContain(CENTINELA_EMAIL);
    expect(rastro).not.toContain(CENTINELA_TELEFONO);
  });

  it('email malformado (422 validation_failed): el error nombra el CAMPO, nunca el VALOR', async () => {
    const cliente = await clienteConCarrito('gas-r134a');
    const body = buyerCentinela();
    const res = await cliente.post({
      ...body,
      buyer: { ...body.buyer, email: `${CENTINELA_EMAIL}-invalido-sin-arroba` },
    });
    expect(res.status).toBe(422);

    // El valor exacto que se mandó (el email malformado) no puede aparecer:
    // class-validator nombra el campo ('buyer.email no tiene un formato
    // válido'), nunca ecoa el valor recibido.
    const rastro = todoElRastro([res]);
    expect(rastro).not.toContain(`${CENTINELA_EMAIL}-invalido-sin-arroba`);
    expect(rastro).not.toContain(CENTINELA_NOMBRE);
    expect(rastro).not.toContain(CENTINELA_TELEFONO);
  });

  it('el test se prueba a sí mismo: un centinela sembrado a mano SÍ dispara el fallo', () => {
    // Negative control (per T4.2 Verify): si este `expect` pasara con un log
    // que contiene el centinela, la aserción de arriba sería un placebo que no
    // mira nada. Se prueba explícitamente que el mecanismo detecta la fuga.
    capturado.push({ event: 'x', buyer_email: CENTINELA_EMAIL });

    expect(() => {
      expect(JSON.stringify(capturado)).not.toContain(CENTINELA_EMAIL);
    }).toThrow();
  });
});
