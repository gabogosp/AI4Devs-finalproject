import { PrismaService } from '../prisma/prisma.service';
import { OrdersRepository } from './orders.repository';

/**
 * T1.2 — integration contra el Postgres real de docker-compose. Lo que se prueba
 * acá no es que Prisma funcione, sino las dos propiedades que el diseño le pide
 * a este repositorio y que un mock no podría demostrar: que `createPendingOrder`
 * es atómica (una línea inválida no deja una orden huérfana) y que
 * `findByTokenHash` distingue hash correcto de incorrecto.
 */
describe('OrdersRepository (integration)', () => {
  const prisma = new PrismaService();
  const repo = new OrdersRepository(prisma);

  let productoA = '';
  let productoB = '';
  let productoC = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, products, categories, customers RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    productoA = (
      await prisma.product.create({
        data: {
          sku: 'ORD-REPO-A',
          slug: 'compresor-embraco',
          name: 'Compresor Embraco',
          price_ars_cents: 12_500_000,
          stock: 3,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    productoB = (
      await prisma.product.create({
        data: {
          sku: 'ORD-REPO-B',
          slug: 'gas-r134a',
          name: 'Gas R134a',
          price_ars_cents: 850_000,
          stock: 8,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    productoC = (
      await prisma.product.create({
        data: {
          sku: 'ORD-REPO-C',
          slug: 'cable-cobre-3x2',
          name: 'Cable de cobre 3x2',
          price_ars_cents: 430_000,
          stock: 20,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
  });

  function ordenBase(sufijo: string) {
    return {
      accessTokenHash: `h-${sufijo}`,
      buyerName: 'Comprador de Prueba',
      buyerEmail: `comprador-${sufijo}@test.local`,
      buyerPhone: '+54 351 555 0000',
      consentAcceptedAt: new Date(),
      consentTermsVersion: '2026-06-15',
    };
  }

  it('createPendingOrder con 3 líneas: 1 orden + 3 order_items', async () => {
    const orden = await repo.createPendingOrder({
      ...ordenBase('happy'),
      totalArsCents: 12_500_000 + 850_000 * 2 + 430_000 * 3,
      lines: [
        {
          productId: productoA,
          quantity: 1,
          unitPriceArsCents: 12_500_000,
          productName: 'Compresor Embraco',
          productSku: 'ORD-REPO-A',
        },
        {
          productId: productoB,
          quantity: 2,
          unitPriceArsCents: 850_000,
          productName: 'Gas R134a',
          productSku: 'ORD-REPO-B',
        },
        {
          productId: productoC,
          quantity: 3,
          unitPriceArsCents: 430_000,
          productName: 'Cable de cobre 3x2',
          productSku: 'ORD-REPO-C',
        },
      ],
    });

    expect(orden.status).toBe('pending_payment');
    expect(orden.items).toHaveLength(3);

    const ordenesEnBase = await prisma.order.count();
    const itemsEnBase = await prisma.orderItem.count();
    expect(ordenesEnBase).toBe(1);
    expect(itemsEnBase).toBe(3);
  });

  it('atomicidad: una línea con product_id inexistente deja 0 órdenes y 0 líneas', async () => {
    const productoInexistente = '00000000-0000-0000-0000-000000000000';

    await expect(
      repo.createPendingOrder({
        ...ordenBase('atomic'),
        totalArsCents: 12_500_000 + 850_000,
        lines: [
          {
            productId: productoA,
            quantity: 1,
            unitPriceArsCents: 12_500_000,
            productName: 'Compresor Embraco',
            productSku: 'ORD-REPO-A',
          },
          {
            productId: productoInexistente,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Fantasma',
            productSku: 'NO-EXISTE',
          },
        ],
      }),
    ).rejects.toThrow();

    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.orderItem.count()).toBe(0);
  });

  it('findByTokenHash: hash correcto encuentra la orden con sus líneas', async () => {
    const creada = await repo.createPendingOrder({
      ...ordenBase('find-ok'),
      totalArsCents: 850_000,
      lines: [
        {
          productId: productoB,
          quantity: 1,
          unitPriceArsCents: 850_000,
          productName: 'Gas R134a',
          productSku: 'ORD-REPO-B',
        },
      ],
    });

    const encontrada = await repo.findByTokenHash('h-find-ok');

    expect(encontrada?.id).toBe(creada.id);
    expect(encontrada?.items).toHaveLength(1);
  });

  it('findByTokenHash: hash incorrecto devuelve null', async () => {
    await repo.createPendingOrder({
      ...ordenBase('find-miss'),
      totalArsCents: 850_000,
      lines: [
        {
          productId: productoB,
          quantity: 1,
          unitPriceArsCents: 850_000,
          productName: 'Gas R134a',
          productSku: 'ORD-REPO-B',
        },
      ],
    });

    expect(await repo.findByTokenHash('h-no-existe')).toBeNull();
  });

  /**
   * T1.2 — `anonymize` guardado por `WHERE anonymized_at IS NULL` (AC-8): la
   * idempotencia es estructural, no una excepción atrapada.
   */
  describe('anonymize (US-021 T1.2)', () => {
    it('sobre una orden sin anonimizar, escribe los placeholders + anonymized_at/reason', async () => {
      const creada = await repo.createPendingOrder({
        ...ordenBase('anon-happy'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });

      const resultado = await repo.anonymize(creada.id, 'requested');

      expect(resultado?.anonymizationReason).toBe('requested');
      expect(resultado?.anonymizedAt).toBeInstanceOf(Date);

      const releida = await prisma.order.findUniqueOrThrow({ where: { id: creada.id } });
      expect(releida.buyer_name).toBe('Comprador anonimizado');
      expect(releida.buyer_email).toBe('datos-suprimidos@anonimizado.dsm.invalid');
      expect(releida.buyer_phone).toBe('+00 000-0000');
      expect(releida.anonymized_at).not.toBeNull();
      expect(releida.anonymization_reason).toBe('requested');
    });

    it('sobre una orden ya anonimizada, no vuelve a escribir (mismo anonymized_at, sin error)', async () => {
      const creada = await repo.createPendingOrder({
        ...ordenBase('anon-noop'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });

      const primera = await repo.anonymize(creada.id, 'requested');
      const segunda = await repo.anonymize(creada.id, 'retention_policy');

      expect(segunda?.anonymizedAt).toEqual(primera?.anonymizedAt);
      expect(segunda?.anonymizationReason).toBe('requested'); // no lo pisó el segundo motivo
    });

    it('sobre un id inexistente, devuelve null', async () => {
      const inexistente = '00000000-0000-0000-0000-000000000000';
      expect(await repo.anonymize(inexistente, 'requested')).toBeNull();
    });
  });

  /**
   * T1.3 — barrido de conjunto, un único `updateMany` (sin bucle por fila).
   */
  describe('anonymizeRetentionEligible (US-021 T1.3)', () => {
    it('anonimiza sólo las vencidas; segunda corrida con el mismo corte devuelve 0', async () => {
      const vencida1 = await repo.createPendingOrder({
        ...ordenBase('sweep-1'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      const vencida2 = await repo.createPendingOrder({
        ...ordenBase('sweep-2'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      const noVencida = await repo.createPendingOrder({
        ...ordenBase('sweep-3'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });

      const hace13Meses = new Date();
      hace13Meses.setMonth(hace13Meses.getMonth() - 13);
      const hace6Meses = new Date();
      hace6Meses.setMonth(hace6Meses.getMonth() - 6);

      await prisma.order.update({ where: { id: vencida1.id }, data: { created_at: hace13Meses } });
      await prisma.order.update({ where: { id: vencida2.id }, data: { created_at: hace13Meses } });
      await prisma.order.update({ where: { id: noVencida.id }, data: { created_at: hace6Meses } });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);

      const primeraCorrida = await repo.anonymizeRetentionEligible(cutoff, 'retention_policy');
      expect(primeraCorrida).toBe(2);

      const segundaCorrida = await repo.anonymizeRetentionEligible(cutoff, 'retention_policy');
      expect(segundaCorrida).toBe(0);

      const sinTocar = await prisma.order.findUniqueOrThrow({ where: { id: noVencida.id } });
      expect(sinTocar.anonymized_at).toBeNull();
    });
  });

  /** T1.3 (US-020) — bloqueo de baja de cuenta + anonimización por cliente. */
  describe('listBlockingForCustomer / anonymizeAllForCustomer (US-020 T1.3)', () => {
    async function crearCliente(sufijo: string) {
      return prisma.customer.create({
        data: {
          email: `cliente-${sufijo}@test.local`,
          password_hash: 'hash-de-prueba',
          name: `Cliente ${sufijo}`,
        },
      });
    }

    async function crearOrdenDe(sufijo: string, customerId: string, status: string) {
      const orden = await repo.createPendingOrder({
        ...ordenBase(sufijo),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      await prisma.order.update({
        where: { id: orden.id },
        data: { customer_id: customerId, ...(status !== 'pending_payment' ? { status } : {}) },
      });
      return orden;
    }

    it('listBlockingForCustomer: sólo las 4 estados bloqueantes del cliente, ninguna delivered/cancelled ni ajena', async () => {
      const propio = await crearCliente('block-propio');
      const ajeno = await crearCliente('block-ajeno');

      const pendiente = await crearOrdenDe('block-pending', propio.id, 'pending_payment');
      const nueva = await crearOrdenDe('block-new', propio.id, 'new');
      const entregada = await crearOrdenDe('block-delivered', propio.id, 'delivered');
      const cancelada = await crearOrdenDe('block-cancelled', propio.id, 'cancelled');
      await crearOrdenDe('block-ajena', ajeno.id, 'new');

      const bloqueantes = await repo.listBlockingForCustomer(propio.id);

      expect(bloqueantes.map((o) => o.id).sort()).toEqual(
        [pendiente.id, nueva.id].sort(),
      );
      expect(bloqueantes.map((o) => o.id)).not.toContain(entregada.id);
      expect(bloqueantes.map((o) => o.id)).not.toContain(cancelada.id);
    });

    it('anonymizeAllForCustomer: anonimiza todas las no anonimizadas del cliente, deja intacta la de otro cliente, segunda corrida en 0', async () => {
      const propio = await crearCliente('anon-propio');
      const ajeno = await crearCliente('anon-ajeno');

      const propia1 = await crearOrdenDe('anon-c-1', propio.id, 'delivered');
      const propia2 = await crearOrdenDe('anon-c-2', propio.id, 'cancelled');
      const ajena = await crearOrdenDe('anon-c-3', ajeno.id, 'delivered');

      const primeraCorrida = await repo.anonymizeAllForCustomer(propio.id, 'account_deletion');
      expect(primeraCorrida).toBe(2);

      const [releida1, releida2, releidaAjena] = await Promise.all([
        prisma.order.findUniqueOrThrow({ where: { id: propia1.id } }),
        prisma.order.findUniqueOrThrow({ where: { id: propia2.id } }),
        prisma.order.findUniqueOrThrow({ where: { id: ajena.id } }),
      ]);
      expect(releida1.anonymization_reason).toBe('account_deletion');
      expect(releida2.anonymization_reason).toBe('account_deletion');
      expect(releidaAjena.anonymized_at).toBeNull();

      const segundaCorrida = await repo.anonymizeAllForCustomer(propio.id, 'account_deletion');
      expect(segundaCorrida).toBe(0);
    });
  });

  /** T3.1 — list/findById/updateStatusConditional (US-012, admin fulfillment). */
  async function crearOrdenConEstado(sufijo: string, status: string) {
    const creada = await repo.createPendingOrder({
      ...ordenBase(sufijo),
      totalArsCents: 850_000,
      lines: [
        {
          productId: productoB,
          quantity: 1,
          unitPriceArsCents: 850_000,
          productName: 'Gas R134a',
          productSku: 'ORD-REPO-B',
        },
      ],
    });
    if (status !== 'pending_payment') {
      await prisma.order.update({ where: { id: creada.id }, data: { status } });
    }
    return creada;
  }

  it('list: statusIn filtra — 3 órdenes sembradas (new/preparing/pending_payment), statusIn:[new,preparing] → 2 filas, total=2', async () => {
    await crearOrdenConEstado('list-new', 'new');
    await crearOrdenConEstado('list-prep', 'preparing');
    await crearOrdenConEstado('list-pend', 'pending_payment');

    const { data, total } = await repo.list({
      statusIn: ['new', 'preparing'],
      sortField: 'order_number',
      sortDesc: false,
      limit: 20,
      offset: 0,
    });

    expect(total).toBe(2);
    expect(data).toHaveLength(2);
    expect(data.map((o) => o.status).sort()).toEqual(['new', 'preparing']);
  });

  it('list: sortDesc cambia el orden de data', async () => {
    const a = await crearOrdenConEstado('sort-a', 'new');
    const b = await crearOrdenConEstado('sort-b', 'new');

    const asc = await repo.list({
      statusIn: ['new'],
      sortField: 'order_number',
      sortDesc: false,
      limit: 20,
      offset: 0,
    });
    const desc = await repo.list({
      statusIn: ['new'],
      sortField: 'order_number',
      sortDesc: true,
      limit: 20,
      offset: 0,
    });

    expect(asc.data.map((o) => o.id)).toEqual([a.id, b.id]);
    expect(desc.data.map((o) => o.id)).toEqual([b.id, a.id]);
  });

  it('findById: una orden pending_payment devuelve objeto no nulo con items (el filtro AC-8 no vive acá)', async () => {
    const creada = await crearOrdenConEstado('find-pending', 'pending_payment');

    const encontrada = await repo.findById(creada.id);

    expect(encontrada).not.toBeNull();
    expect(encontrada?.items).toHaveLength(1);
    expect(encontrada?.status).toBe('pending_payment');
  });

  it('findById: encuentra la orden por su uuid interno, con items (US-023, distingue 404 de 409)', async () => {
    const creada = await repo.createPendingOrder({
      ...ordenBase('find-by-id'),
      totalArsCents: 850_000,
      lines: [
        {
          productId: productoB,
          quantity: 1,
          unitPriceArsCents: 850_000,
          productName: 'Gas R134a',
          productSku: 'ORD-REPO-B',
        },
      ],
    });

    const encontrada = await repo.findById(creada.id);
    expect(encontrada?.id).toBe(creada.id);
    expect(encontrada?.items).toHaveLength(1);
  });

  it('findById: uuid inexistente devuelve null', async () => {
    expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('updateStatusConditional: la orden ya no está en `from` (carrera) → null', async () => {
    const creada = await crearOrdenConEstado('race', 'preparing');

    const resultado = await prisma.$transaction((tx) =>
      repo.updateStatusConditional(creada.id, 'new', 'preparing', tx),
    );

    expect(resultado).toBeNull();
    // la orden sigue en `preparing` — el UPDATE condicional no tocó nada
    const actual = await prisma.order.findUniqueOrThrow({ where: { id: creada.id } });
    expect(actual.status).toBe('preparing');
  });

  it('updateStatusConditional: to=delivered setea delivered_at', async () => {
    const creada = await crearOrdenConEstado('deliver', 'ready');

    const resultado = await prisma.$transaction((tx) =>
      repo.updateStatusConditional(creada.id, 'ready', 'delivered', tx),
    );

    expect(resultado).not.toBeNull();
    expect(resultado?.status).toBe('delivered');
    expect(resultado?.delivered_at).not.toBeNull();
  });

  it('transitionToNewIfPending: sobre pending_payment, transiciona a new y devuelve la orden con items (US-023 AC-1)', async () => {
    const creada = await repo.createPendingOrder({
      ...ordenBase('transition-ok'),
      totalArsCents: 850_000,
      lines: [
        {
          productId: productoB,
          quantity: 1,
          unitPriceArsCents: 850_000,
          productName: 'Gas R134a',
          productSku: 'ORD-REPO-B',
        },
      ],
    });

    const resultado = await repo.transitionToNewIfPending(creada.id);

    expect(resultado?.status).toBe('new');
    expect(resultado?.items).toHaveLength(1);
    const enBase = await prisma.order.findUniqueOrThrow({ where: { id: creada.id } });
    expect(enBase.status).toBe('new');
  });

  it('transitionToNewIfPending: sobre una orden que ya no está pending_payment, devuelve null y no cambia nada (US-023 AC-4/AC-5)', async () => {
    const creada = await repo.createPendingOrder({
      ...ordenBase('transition-noop'),
      totalArsCents: 850_000,
      lines: [
        {
          productId: productoB,
          quantity: 1,
          unitPriceArsCents: 850_000,
          productName: 'Gas R134a',
          productSku: 'ORD-REPO-B',
        },
      ],
    });
    await repo.transitionToNewIfPending(creada.id); // ya queda en `new`

    const segundaVez = await repo.transitionToNewIfPending(creada.id);

    expect(segundaVez).toBeNull();
    const enBase = await prisma.order.findUniqueOrThrow({ where: { id: creada.id } });
    expect(enBase.status).toBe('new'); // sin cambios por el segundo intento
  });

  it('listByStatus: devuelve sólo las órdenes del estado pedido, más nuevas primero (US-023 AC-2)', async () => {
    const pendienteVieja = await repo.createPendingOrder({
      ...ordenBase('list-pending-1'),
      totalArsCents: 850_000,
      lines: [
        {
          productId: productoB,
          quantity: 1,
          unitPriceArsCents: 850_000,
          productName: 'Gas R134a',
          productSku: 'ORD-REPO-B',
        },
      ],
    });
    const pendienteNueva = await repo.createPendingOrder({
      ...ordenBase('list-pending-2'),
      totalArsCents: 430_000,
      lines: [
        {
          productId: productoC,
          quantity: 1,
          unitPriceArsCents: 430_000,
          productName: 'Cable de cobre 3x2',
          productSku: 'ORD-REPO-C',
        },
      ],
    });
    const confirmada = await repo.createPendingOrder({
      ...ordenBase('list-confirmed'),
      totalArsCents: 12_500_000,
      lines: [
        {
          productId: productoA,
          quantity: 1,
          unitPriceArsCents: 12_500_000,
          productName: 'Compresor Embraco',
          productSku: 'ORD-REPO-A',
        },
      ],
    });
    await repo.transitionToNewIfPending(confirmada.id);

    const pendientes = await repo.listByStatus('pending_payment');

    expect(pendientes.map((o) => o.id)).toEqual([pendienteNueva.id, pendienteVieja.id]);
  });

  it('transitionToNewIfPending: setea confirmed_at (US-010 T2.2)', async () => {
    const creada = await crearOrdenConEstado('confirmed-at', 'pending_payment');

    const resultado = await repo.transitionToNewIfPending(creada.id);

    expect(resultado?.confirmed_at).not.toBeNull();
  });

  it('transitionToCancelledIfPending: sobre pending_payment, cancela y setea cancelled_at (US-010 T2.2)', async () => {
    const creada = await crearOrdenConEstado('cancel-ok', 'pending_payment');

    const resultado = await prisma.$transaction((tx) =>
      repo.transitionToCancelledIfPending(creada.id, tx),
    );

    expect(resultado?.status).toBe('cancelled');
    expect(resultado?.cancelled_at).not.toBeNull();
  });

  it('transitionToCancelledIfPending: sobre una orden que ya no está pending_payment, devuelve null y no la toca (US-010 T2.2)', async () => {
    const creada = await crearOrdenConEstado('cancel-noop', 'new');

    const resultado = await prisma.$transaction((tx) =>
      repo.transitionToCancelledIfPending(creada.id, tx),
    );

    expect(resultado).toBeNull();
    const enBase = await prisma.order.findUniqueOrThrow({ where: { id: creada.id } });
    expect(enBase.status).toBe('new');
    expect(enBase.cancelled_at).toBeNull();
  });

  /** US-015 T2.1/T2.2 — historial de compras del cliente autenticado. */
  describe('listByCustomer (US-015 T2.1, AC-1/AC-4/AC-7)', () => {
    async function crearCliente(sufijo: string) {
      return prisma.customer.create({
        data: {
          email: `cliente-${sufijo}@test.local`,
          password_hash: 'hash-de-prueba',
          name: `Cliente ${sufijo}`,
        },
      });
    }

    async function crearOrdenDe(sufijo: string, customerId?: string) {
      const orden = await repo.createPendingOrder({
        ...ordenBase(sufijo),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      if (customerId) {
        await prisma.order.update({ where: { id: orden.id }, data: { customer_id: customerId } });
      }
      // Las recién creadas quedan pending_payment; para "compras" reales del
      // historial se confirman.
      return repo.transitionToNewIfPending(orden.id);
    }

    it('dado un customerId con 3 órdenes propias (2 dentro de retención, 1 fuera) y 1 orden ajena, devuelve exactamente las 2 propias dentro de ventana, orden -created_at, excluyendo pending_payment', async () => {
      const propio = await crearCliente('propio');
      const ajeno = await crearCliente('ajeno');

      const propiaVieja = await crearOrdenDe('hist-vieja', propio.id);
      const propiaReciente = await crearOrdenDe('hist-reciente', propio.id);
      const propiaFueraDeVentana = await crearOrdenDe('hist-fuera', propio.id);
      await crearOrdenDe('hist-ajena', ajeno.id);

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);

      await prisma.order.update({
        where: { id: propiaVieja!.id },
        data: { created_at: new Date(cutoff.getTime() + 60_000) }, // dentro, más vieja
      });
      await prisma.order.update({
        where: { id: propiaReciente!.id },
        data: { created_at: new Date(cutoff.getTime() + 120_000) }, // dentro, más nueva
      });
      await prisma.order.update({
        where: { id: propiaFueraDeVentana!.id },
        data: { created_at: new Date(cutoff.getTime() - 60_000) }, // fuera
      });

      const { data, total } = await repo.listByCustomer(propio.id, {
        cutoff,
        limit: 20,
        offset: 0,
      });

      expect(total).toBe(2);
      expect(data.map((o) => o.id)).toEqual([propiaReciente!.id, propiaVieja!.id]);
    });

    it('excluye las órdenes pending_payment del cliente (no son una "compra")', async () => {
      const cliente = await crearCliente('pending');
      const pendiente = await repo.createPendingOrder({
        ...ordenBase('hist-pending'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      await prisma.order.update({
        where: { id: pendiente.id },
        data: { customer_id: cliente.id },
      });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);
      const { data, total } = await repo.listByCustomer(cliente.id, {
        cutoff,
        limit: 20,
        offset: 0,
      });

      expect(total).toBe(0);
      expect(data).toHaveLength(0);
    });

    it('sin órdenes, devuelve data vacío y total 0', async () => {
      const cliente = await crearCliente('vacio');
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);

      const { data, total } = await repo.listByCustomer(cliente.id, {
        cutoff,
        limit: 20,
        offset: 0,
      });

      expect(data).toHaveLength(0);
      expect(total).toBe(0);
    });
  });

  describe('findByOrderNumberForCustomer (US-015 T2.2, AC-2/AC-4/AC-5/AC-7 — IDOR)', () => {
    async function crearCliente(sufijo: string) {
      return prisma.customer.create({
        data: {
          email: `cliente-${sufijo}@test.local`,
          password_hash: 'hash-de-prueba',
          name: `Cliente ${sufijo}`,
        },
      });
    }

    it('orden propia dentro de retención y confirmada: la encuentra con items', async () => {
      const cliente = await crearCliente('detalle-ok');
      const creada = await repo.createPendingOrder({
        ...ordenBase('detalle-ok'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      await prisma.order.update({
        where: { id: creada.id },
        data: { customer_id: cliente.id, status: 'new' },
      });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);

      const encontrada = await repo.findByOrderNumberForCustomer(
        creada.order_number,
        cliente.id,
        cutoff,
      );

      expect(encontrada?.id).toBe(creada.id);
      expect(encontrada?.items).toHaveLength(1);
    });

    it('orden ajena: devuelve null (indistinguible de "no existe")', async () => {
      const propio = await crearCliente('detalle-propio');
      const ajeno = await crearCliente('detalle-ajeno');
      const creada = await repo.createPendingOrder({
        ...ordenBase('detalle-ajena'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      await prisma.order.update({
        where: { id: creada.id },
        data: { customer_id: ajeno.id, status: 'new' },
      });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);

      expect(
        await repo.findByOrderNumberForCustomer(creada.order_number, propio.id, cutoff),
      ).toBeNull();
    });

    it('orden propia pending_payment: devuelve null', async () => {
      const cliente = await crearCliente('detalle-pending');
      const creada = await repo.createPendingOrder({
        ...ordenBase('detalle-pending'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      await prisma.order.update({
        where: { id: creada.id },
        data: { customer_id: cliente.id },
      });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);

      expect(
        await repo.findByOrderNumberForCustomer(creada.order_number, cliente.id, cutoff),
      ).toBeNull();
    });

    it('orden propia fuera de la ventana de retención: devuelve null', async () => {
      const cliente = await crearCliente('detalle-fuera');
      const creada = await repo.createPendingOrder({
        ...ordenBase('detalle-fuera'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);
      await prisma.order.update({
        where: { id: creada.id },
        data: {
          customer_id: cliente.id,
          status: 'new',
          created_at: new Date(cutoff.getTime() - 60_000),
        },
      });

      expect(
        await repo.findByOrderNumberForCustomer(creada.order_number, cliente.id, cutoff),
      ).toBeNull();
    });

    it('order_number inexistente: devuelve null', async () => {
      const cliente = await crearCliente('detalle-inexistente');
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);

      expect(
        await repo.findByOrderNumberForCustomer(999_999, cliente.id, cutoff),
      ).toBeNull();
    });
  });

  /** US-015 T5.9 — borde exacto del corte de retención (`gte`, sin off-by-one). */
  describe('listByCustomer / findByOrderNumberForCustomer — borde del corte (US-015 T5.9, AC-7)', () => {
    async function crearCliente(sufijo: string) {
      return prisma.customer.create({
        data: {
          email: `cliente-${sufijo}@test.local`,
          password_hash: 'hash-de-prueba',
          name: `Cliente ${sufijo}`,
        },
      });
    }

    it('orden con created_at EXACTAMENTE en el cutoff: incluida (gte)', async () => {
      const cliente = await crearCliente('borde-incluida');
      const creada = await repo.createPendingOrder({
        ...ordenBase('borde-incluida'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      const cutoff = new Date();
      await prisma.order.update({
        where: { id: creada.id },
        data: { customer_id: cliente.id, status: 'new', created_at: cutoff },
      });

      const { total } = await repo.listByCustomer(cliente.id, { cutoff, limit: 20, offset: 0 });
      expect(total).toBe(1);
      expect(
        await repo.findByOrderNumberForCustomer(creada.order_number, cliente.id, cutoff),
      ).not.toBeNull();
    });

    it('orden con created_at 1ms ANTES del cutoff: excluida', async () => {
      const cliente = await crearCliente('borde-excluida');
      const creada = await repo.createPendingOrder({
        ...ordenBase('borde-excluida'),
        totalArsCents: 850_000,
        lines: [
          {
            productId: productoB,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Gas R134a',
            productSku: 'ORD-REPO-B',
          },
        ],
      });
      const cutoff = new Date();
      await prisma.order.update({
        where: { id: creada.id },
        data: {
          customer_id: cliente.id,
          status: 'new',
          created_at: new Date(cutoff.getTime() - 1),
        },
      });

      const { total } = await repo.listByCustomer(cliente.id, { cutoff, limit: 20, offset: 0 });
      expect(total).toBe(0);
      expect(
        await repo.findByOrderNumberForCustomer(creada.order_number, cliente.id, cutoff),
      ).toBeNull();
    });
  });

  it('cancelAbandonedPending: cancela sólo las pending_payment con created_at anterior al corte (US-010 T2.2)', async () => {
    const vieja = await crearOrdenConEstado('abandoned-old', 'pending_payment');
    const nueva = await crearOrdenConEstado('abandoned-new', 'pending_payment');
    const corte = new Date(Date.now() + 1000 * 60 * 60); // 1h en el futuro: sólo "vieja" ya existe antes de esto
    await prisma.order.update({
      where: { id: nueva.id },
      data: { created_at: new Date(Date.now() + 1000 * 60 * 60 * 2) }, // 2h en el futuro: queda del lado "nuevo" del corte
    });

    const cantidad = await repo.cancelAbandonedPending(corte);

    expect(cantidad).toBe(1);
    const viejaEnBase = await prisma.order.findUniqueOrThrow({ where: { id: vieja.id } });
    const nuevaEnBase = await prisma.order.findUniqueOrThrow({ where: { id: nueva.id } });
    expect(viejaEnBase.status).toBe('cancelled');
    expect(viejaEnBase.cancelled_at).not.toBeNull();
    expect(nuevaEnBase.status).toBe('pending_payment');
    expect(nuevaEnBase.cancelled_at).toBeNull();
  });

  it.each(['new', 'preparing', 'ready'])(
    'transitionToCancelledIfActive: sobre %s, cancela, setea cancelled_at e incluye items (US-013 T2.2)',
    async (status) => {
      const creada = await crearOrdenConEstado(`cancel-active-${status}`, status);

      const resultado = await prisma.$transaction((tx) =>
        repo.transitionToCancelledIfActive(creada.id, tx),
      );

      expect(resultado?.status).toBe('cancelled');
      expect(resultado?.cancelled_at).not.toBeNull();
      expect(resultado?.items.length).toBeGreaterThan(0);
    },
  );

  it.each(['delivered', 'cancelled', 'pending_payment'])(
    'transitionToCancelledIfActive: sobre %s, devuelve null y no escribe nada (US-013 AC-7/AC-8, T2.2)',
    async (status) => {
      const creada = await crearOrdenConEstado(`cancel-active-noop-${status}`, status);

      const resultado = await prisma.$transaction((tx) =>
        repo.transitionToCancelledIfActive(creada.id, tx),
      );

      expect(resultado).toBeNull();
      const enBase = await prisma.order.findUniqueOrThrow({ where: { id: creada.id } });
      expect(enBase.status).toBe(status);
      expect(enBase.cancelled_at).toBeNull();
    },
  );

  /** T2 (US-025) — elegibilidad para reseñar: orden `delivered` con el producto. */
  describe('hasDeliveredOrderWithProduct (US-025 T2)', () => {
    async function crearCliente(sufijo: string) {
      return prisma.customer.create({
        data: {
          email: `resena-${sufijo}@test.local`,
          password_hash: 'hash-de-prueba',
          name: `Cliente ${sufijo}`,
        },
      });
    }

    async function crearOrdenConProducto(
      sufijo: string,
      customerId: string,
      productId: string,
      status: string,
    ) {
      const orden = await repo.createPendingOrder({
        ...ordenBase(sufijo),
        totalArsCents: 850_000,
        lines: [
          {
            productId,
            quantity: 1,
            unitPriceArsCents: 850_000,
            productName: 'Producto de prueba',
            productSku: 'RESENA-SKU',
          },
        ],
      });
      await prisma.order.update({
        where: { id: orden.id },
        data: { customer_id: customerId, ...(status !== 'pending_payment' ? { status } : {}) },
      });
      return orden;
    }

    it('orden delivered con el producto: true', async () => {
      const cliente = await crearCliente('elegible');
      await crearOrdenConProducto('elegible-1', cliente.id, productoA, 'delivered');

      expect(await repo.hasDeliveredOrderWithProduct(cliente.id, productoA)).toBe(true);
    });

    it.each(['pending_payment', 'new', 'preparing', 'ready', 'cancelled'])(
      'orden en %s con el producto: false (sólo delivered habilita)',
      async (status) => {
        const cliente = await crearCliente(`no-elegible-${status}`);
        await crearOrdenConProducto(`no-elegible-${status}`, cliente.id, productoA, status);

        expect(await repo.hasDeliveredOrderWithProduct(cliente.id, productoA)).toBe(false);
      },
    );

    it('orden delivered pero de OTRO producto: false', async () => {
      const cliente = await crearCliente('otro-producto');
      await crearOrdenConProducto('otro-producto-1', cliente.id, productoA, 'delivered');

      expect(await repo.hasDeliveredOrderWithProduct(cliente.id, productoB)).toBe(false);
    });

    it('orden delivered del producto pero de OTRO cliente: false', async () => {
      const propio = await crearCliente('propio-delivered');
      const ajeno = await crearCliente('ajeno-delivered');
      await crearOrdenConProducto('ajeno-delivered-1', ajeno.id, productoA, 'delivered');

      expect(await repo.hasDeliveredOrderWithProduct(propio.id, productoA)).toBe(false);
    });

    it('cliente sin ninguna orden: false', async () => {
      const cliente = await crearCliente('sin-ordenes');

      expect(await repo.hasDeliveredOrderWithProduct(cliente.id, productoA)).toBe(false);
    });
  });

  /** T2 (US-026) — ranking público-safe de "más vendidos" (AC-2, AC-5, AC-6, AC-7). */
  describe('mostSold (US-026 T2)', () => {
    async function crearOrdenConLinea(
      sufijo: string,
      status: string,
      lineas: Array<{ productId: string; quantity: number }>,
    ) {
      const orden = await repo.createPendingOrder({
        ...ordenBase(sufijo),
        totalArsCents: 100_000,
        lines: lineas.map((l, i) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPriceArsCents: 100_000,
          productName: 'Producto',
          productSku: `MS-${sufijo}-${i}`,
        })),
      });
      if (status !== 'pending_payment') {
        await prisma.order.update({ where: { id: orden.id }, data: { status } });
      }
      return orden;
    }

    it('ranking por cantidad vendida (no por revenue), órdenes confirmadas', async () => {
      // A: 5 unidades (delivered), B: 2 unidades (preparing).
      await crearOrdenConLinea('ms-1', 'delivered', [{ productId: productoA, quantity: 5 }]);
      await crearOrdenConLinea('ms-2', 'preparing', [{ productId: productoB, quantity: 2 }]);

      const ranking = await repo.mostSold(8);

      expect(ranking.map((r) => r.id)).toEqual([productoA, productoB]);
    });

    it('excluye pending_payment y cancelled (AC-5-like)', async () => {
      await crearOrdenConLinea('ms-3', 'pending_payment', [{ productId: productoA, quantity: 9 }]);
      await crearOrdenConLinea('ms-4', 'cancelled', [{ productId: productoB, quantity: 9 }]);
      await crearOrdenConLinea('ms-5', 'delivered', [{ productId: productoC, quantity: 1 }]);

      const ranking = await repo.mostSold(8);

      expect(ranking.map((r) => r.id)).toEqual([productoC]);
    });

    it('sin ninguna orden confirmada: [] (AC-5)', async () => {
      await crearOrdenConLinea('ms-6', 'pending_payment', [{ productId: productoA, quantity: 3 }]);

      expect(await repo.mostSold(8)).toEqual([]);
    });

    it('un producto despublicado no aparece aunque tenga ventas (AC-7)', async () => {
      await crearOrdenConLinea('ms-7', 'delivered', [{ productId: productoB, quantity: 4 }]);
      await prisma.product.update({ where: { id: productoB }, data: { status: 'archived' } });

      const ranking = await repo.mostSold(8);
      expect(ranking.map((r) => r.id)).not.toContain(productoB);
    });

    it('empate de cantidad vendida: tie-break determinista por id (AC-6)', async () => {
      await crearOrdenConLinea('ms-8', 'delivered', [{ productId: productoA, quantity: 3 }]);
      await crearOrdenConLinea('ms-9', 'delivered', [{ productId: productoB, quantity: 3 }]);
      const ordenEsperado = [productoA, productoB].sort();

      const ranking = await repo.mostSold(8);
      expect(ranking.map((r) => r.id)).toEqual(ordenEsperado);
    });

    it('nunca expone revenue_ars_cents ni sku', async () => {
      await crearOrdenConLinea('ms-10', 'delivered', [{ productId: productoA, quantity: 1 }]);

      const ranking = await repo.mostSold(8);
      expect(ranking[0]).not.toHaveProperty('revenue_ars_cents');
      expect(ranking[0]).not.toHaveProperty('sku');
    });

    it('respeta el limit', async () => {
      await crearOrdenConLinea('ms-11', 'delivered', [
        { productId: productoA, quantity: 3 },
        { productId: productoB, quantity: 2 },
        { productId: productoC, quantity: 1 },
      ]);

      expect(await repo.mostSold(2)).toHaveLength(2);
    });
  });
});
