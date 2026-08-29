import { INestApplication } from '@nestjs/common';
import { bootTestApp } from '../../test/e2e-app';
import { ClienteDeCarrito, sembrarProductos, truncarCarrito } from '../../test/cart-client';
import { ClienteDeCheckout } from '../../test/checkout-client';
import { PrismaService } from '../prisma/prisma.service';
import { CartModule } from '../cart/cart.module';
import { CheckoutModule } from './checkout.module';

/**
 * T3.1 — el `ValidationPipe` global sobre `CreateCheckoutDto`: `consent`,
 * teléfono, email, y el rechazo de campos que el cliente NUNCA debería poder
 * elegir (`total_ars_cents`, `items`, `cart_id`, `status`, `order_number`).
 */
describe('Validación del checkout (e2e-checkout-validation)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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
      { slug: 'compresor-embraco', price: 12_500_000, stock: 5 },
    ]);
  });

  const buyerValido = () => ({
    buyer: {
      name: 'Comprador de Prueba',
      email: 'comprador@test.local',
      phone: '+54 351 555 0000',
    },
    consent: true,
    fulfillment: 'pickup' as const,
  });

  /** Cliente con un carrito ya armado (cookie + CSRF listos). */
  async function clienteConCarrito(): Promise<ClienteDeCheckout> {
    const carrito = new ClienteDeCarrito(app);
    await carrito.put('compresor-embraco', { quantity: 1 });
    return new ClienteDeCheckout(app, carrito);
  }

  it('cuerpo válido → 201', async () => {
    const cliente = await clienteConCarrito();
    const res = await cliente.post(buyerValido());
    expect(res.status).toBe(201);
  });

  it('consent: false → 422', async () => {
    const cliente = await clienteConCarrito();
    const res = await cliente.post({ ...buyerValido(), consent: false });
    expect(res.status).toBe(422);
  });

  it('consent ausente → 422', async () => {
    const cliente = await clienteConCarrito();
    const { consent, ...sinConsent } = buyerValido();
    const res = await cliente.post(sinConsent);
    expect(res.status).toBe(422);
  });

  it('email malformado → 422 con errors[] que nombra el campo', async () => {
    const cliente = await clienteConCarrito();
    const body = buyerValido();
    const res = await cliente.post({
      ...body,
      buyer: { ...body.buyer, email: 'no-es-un-email' },
    });
    expect(res.status).toBe(422);
    // Nested DTO: `extractField` toma el primer segmento antes del punto
    // ('buyer'), y el `message` completo nombra el campo real ('buyer.email').
    const errores = res.body.errors as Array<{ message: string }> | undefined;
    expect(errores?.some((e) => e.message.includes('email'))).toBe(true);
  });

  it('nombre de 1 carácter → 422', async () => {
    const cliente = await clienteConCarrito();
    const body = buyerValido();
    const res = await cliente.post({
      ...body,
      buyer: { ...body.buyer, name: 'A' },
    });
    expect(res.status).toBe(422);
  });

  it('teléfono ausente → 422 (OQ-BE-2)', async () => {
    const cliente = await clienteConCarrito();
    const body = buyerValido();
    const { phone, ...sinTelefono } = body.buyer;
    const res = await cliente.post({ ...body, buyer: sinTelefono });
    expect(res.status).toBe(422);
  });

  describe('campos que el cliente NUNCA debería poder elegir → 422 (forbidNonWhitelisted)', () => {
    const casos: Array<[string, Record<string, unknown>]> = [
      ['total_ars_cents', { total_ars_cents: 1 }],
      ['items', { items: [] }],
      ['cart_id', { cart_id: 'algo' }],
      ['status', { status: 'new' }],
      ['order_number', { order_number: 1 }],
    ];

    for (const [nombre, extra] of casos) {
      it(`${nombre} inyectado → 422`, async () => {
        const cliente = await clienteConCarrito();
        const res = await cliente.post({ ...buyerValido(), ...extra });
        expect(res.status).toBe(422);
      });
    }
  });

  it('el 201 trae order_number entero ≥ 1000 y no contiene ningún UUID', async () => {
    const cliente = await clienteConCarrito();
    const res = await cliente.post(buyerValido());

    expect(res.status).toBe(201);
    expect(res.body.order_number).toBeGreaterThanOrEqual(1000);
    expect(JSON.stringify(res.body)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
  });
});
