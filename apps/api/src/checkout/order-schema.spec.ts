import { PrismaClient } from '@dsm/db';

/**
 * T0.1 — reconciliación F40: el esquema materializado de `orders`/`order_items`
 * debe tener **exactamente** las columnas, índices y constraints que declara
 * `design.md` §2 Persistencia. Espejo de `cart-schema.spec.ts`.
 *
 * Comparación por conjunto y no por subconjunto: falla si falta una columna **o
 * si sobra una** (así el guardián de AC-7 — ninguna columna capaz de alojar un
 * dato de tarjeta — no depende de que nadie la agregue "para el comprobante").
 *
 * Además de la forma, se prueba el **comportamiento** real: los 6 `CHECK` (que
 * Prisma no declara y van a mano en el `migration.sql`), la `SEQUENCE` de
 * `order_number` arrancando en 1000, y las tres FKs con sus reglas de borrado
 * distintas — CASCADE, RESTRICT y SET NULL.
 */
const prisma = new PrismaClient();

const ESPERADO: Record<string, string[]> = {
  orders: [
    'id',
    'order_number',
    'access_token_hash',
    'customer_id',
    'buyer_name',
    'buyer_email',
    'buyer_phone',
    'fulfillment',
    'status',
    'total_ars_cents',
    'consent_accepted',
    'consent_accepted_at',
    'consent_terms_version',
    'created_at',
    'updated_at',
    'delivered_at',
    // US-021 — retención/anonimización de PII (F40 column-complete).
    'anonymized_at',
    'anonymization_reason',
  ],
  order_items: [
    'id',
    'order_id',
    'product_id',
    'quantity',
    'unit_price_ars_cents',
    'product_name',
    'product_sku',
    'created_at',
  ],
};

const INDICES_ESPERADOS: Record<string, string[]> = {
  orders: [
    'orders_access_token_hash_key',
    'orders_order_number_key',
    'orders_status_created_at_idx',
    'orders_customer_id_idx',
  ],
  order_items: ['order_items_order_id_idx', 'order_items_order_id_product_id_key'],
};

const CHECKS_ESPERADOS: Record<string, string[]> = {
  orders: [
    'orders_status_check',
    'orders_fulfillment_check',
    'orders_total_check',
    'orders_consent_check',
    // US-021 — retención/anonimización de PII (F40 column-complete).
    'orders_anonymization_reason_check',
    'orders_anonymization_consistency_check',
  ],
  order_items: ['order_items_quantity_check', 'order_items_price_check'],
};

/** Categoría + producto publicado mínimos para colgarles una línea de orden. */
async function productoDePrueba(sufijo: string): Promise<string> {
  const categoria = await prisma.category.create({
    data: { name: `Cat ${sufijo}`, slug: `cat-order-schema-${sufijo}` },
  });
  const producto = await prisma.product.create({
    data: {
      sku: `ORDER-SCHEMA-${sufijo}`,
      slug: `order-schema-${sufijo}`,
      name: 'Producto de prueba',
      price_ars_cents: 100_000,
      stock: 5,
      status: 'published',
      category_id: categoria.id,
    },
  });
  return producto.id;
}

function ordenBase(sufijo: string) {
  return {
    access_token_hash: `h-${sufijo}`,
    buyer_name: 'Comprador de Prueba',
    buyer_email: `comprador-${sufijo}@test.local`,
    buyer_phone: '+54 351 555 0000',
    total_ars_cents: 100_000,
    consent_accepted: true,
    consent_accepted_at: new Date(),
    consent_terms_version: '2026-06-15',
  };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Esquema del checkout materializado (F40 — reconciliación con design.md)', () => {
  for (const [tabla, columnas] of Object.entries(ESPERADO)) {
    it(`${tabla}: tiene exactamente las ${columnas.length} columnas declaradas`, async () => {
      const filas = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        tabla,
      );
      const real = filas.map((f) => f.column_name).sort();
      expect(real).toEqual([...columnas].sort());
    });
  }

  for (const [tabla, indices] of Object.entries(INDICES_ESPERADOS)) {
    it(`${tabla}: tiene los índices que el diseño declara`, async () => {
      const filas = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = $1`,
        tabla,
      );
      const real = filas.map((f) => f.indexname);
      for (const idx of indices) expect(real).toContain(idx);
    });
  }

  for (const [tabla, checks] of Object.entries(CHECKS_ESPERADOS)) {
    it(`${tabla}: declara los CHECK que el diseño exige`, async () => {
      const filas = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
        `SELECT c.conname FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relname = $1 AND c.contype = 'c'`,
        tabla,
      );
      const nombres = filas.map((f) => f.conname);
      for (const chk of checks) expect(nombres).toContain(chk);
    });
  }

  it('la SEQUENCE orders_order_number_seq existe y arranca en 1000', async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ start_value: bigint }>>(
      `SELECT start_value FROM pg_sequences WHERE sequencename = 'orders_order_number_seq'`,
    );
    expect(filas).toHaveLength(1);
    expect(Number(filas[0].start_value)).toBe(1000);
  });

  it('CHECK status: un estado fuera de la FSM lo rechaza la BASE', async () => {
    const sufijo = `status-${Date.now()}`;
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO orders (id, order_number, access_token_hash, buyer_name, buyer_email,
          buyer_phone, status, total_ars_cents, consent_accepted, consent_accepted_at,
          consent_terms_version)
         VALUES (gen_random_uuid(), DEFAULT, $1, 'x', 'x@test.local', '+54', 'weird', 100, true, now(), 'v1')`,
        `h-${sufijo}`,
      ),
    ).rejects.toThrow();
  });

  it('CHECK fulfillment: sólo se admite retiro en sucursal (pickup)', async () => {
    const sufijo = `fulfillment-${Date.now()}`;
    await expect(
      prisma.order.create({
        data: { ...ordenBase(sufijo), fulfillment: 'delivery' },
      }),
    ).rejects.toThrow();
  });

  it('CHECK consent_accepted: no existe una orden sin consentimiento', async () => {
    const sufijo = `consent-${Date.now()}`;
    await expect(
      prisma.order.create({
        data: { ...ordenBase(sufijo), consent_accepted: false },
      }),
    ).rejects.toThrow();
  });

  it('CHECK total_ars_cents >= 0: un total negativo lo rechaza la BASE', async () => {
    const sufijo = `total-${Date.now()}`;
    await expect(
      prisma.order.create({
        data: { ...ordenBase(sufijo), total_ars_cents: -1 },
      }),
    ).rejects.toThrow();
  });

  it('CHECK quantity >= 1: una línea con cantidad 0 la rechaza la BASE', async () => {
    const sufijo = `qty-${Date.now()}`;
    const productId = await productoDePrueba(sufijo);
    const orden = await prisma.order.create({ data: ordenBase(sufijo) });

    await expect(
      prisma.orderItem.create({
        data: {
          order_id: orden.id,
          product_id: productId,
          quantity: 0,
          unit_price_ars_cents: 100_000,
          product_name: 'Producto de prueba',
          product_sku: `ORDER-SCHEMA-${sufijo}`,
        },
      }),
    ).rejects.toThrow();
  });

  it('CHECK unit_price_ars_cents >= 0: un precio negativo lo rechaza la BASE', async () => {
    const sufijo = `price-${Date.now()}`;
    const productId = await productoDePrueba(sufijo);
    const orden = await prisma.order.create({ data: ordenBase(sufijo) });

    await expect(
      prisma.orderItem.create({
        data: {
          order_id: orden.id,
          product_id: productId,
          quantity: 1,
          unit_price_ars_cents: -1,
          product_name: 'Producto de prueba',
          product_sku: `ORDER-SCHEMA-${sufijo}`,
        },
      }),
    ).rejects.toThrow();
  });

  it('UNIQUE (order_id, product_id): dos líneas del mismo producto no coexisten', async () => {
    const sufijo = `uniq-${Date.now()}`;
    const productId = await productoDePrueba(sufijo);
    const orden = await prisma.order.create({ data: ordenBase(sufijo) });
    const linea = {
      order_id: orden.id,
      product_id: productId,
      quantity: 1,
      unit_price_ars_cents: 100_000,
      product_name: 'Producto de prueba',
      product_sku: `ORDER-SCHEMA-${sufijo}`,
    };
    await prisma.orderItem.create({ data: linea });

    await expect(prisma.orderItem.create({ data: linea })).rejects.toThrow();
  });

  it('order_number: dos órdenes consecutivas reciben 1000 y 1001, leído de la base', async () => {
    const sufijoA = `seq-a-${Date.now()}`;
    const sufijoB = `seq-b-${Date.now()}`;
    const ordenA = await prisma.order.create({ data: ordenBase(sufijoA) });
    const ordenB = await prisma.order.create({ data: ordenBase(sufijoB) });

    expect(ordenB.order_number).toBe(ordenA.order_number + 1);

    const filas = await prisma.$queryRawUnsafe<Array<{ order_number: number }>>(
      `SELECT order_number FROM orders WHERE id IN ($1::uuid, $2::uuid) ORDER BY order_number`,
      ordenA.id,
      ordenB.id,
    );
    expect(filas.map((f) => f.order_number)).toEqual([
      ordenA.order_number,
      ordenB.order_number,
    ]);
  });

  it('UNIQUE order_number: un INSERT que repita el número lo rechaza la BASE', async () => {
    const sufijo = `dup-num-${Date.now()}`;
    const orden = await prisma.order.create({ data: ordenBase(sufijo) });

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO orders (id, order_number, access_token_hash, buyer_name, buyer_email,
          buyer_phone, total_ars_cents, consent_accepted, consent_accepted_at,
          consent_terms_version)
         VALUES (gen_random_uuid(), $1, $2, 'x', 'x@test.local', '+54', 100, true, now(), 'v1')`,
        orden.order_number,
        `h-dup-${sufijo}`,
      ),
    ).rejects.toThrow();
  });

  it('FK order_id CASCADE: borrar una orden se lleva sus líneas', async () => {
    const sufijo = `casc-${Date.now()}`;
    const productId = await productoDePrueba(sufijo);
    const orden = await prisma.order.create({ data: ordenBase(sufijo) });
    await prisma.orderItem.create({
      data: {
        order_id: orden.id,
        product_id: productId,
        quantity: 2,
        unit_price_ars_cents: 100_000,
        product_name: 'Producto de prueba',
        product_sku: `ORDER-SCHEMA-${sufijo}`,
      },
    });

    await prisma.order.delete({ where: { id: orden.id } });

    expect(await prisma.orderItem.count({ where: { order_id: orden.id } })).toBe(0);
  });

  it('FK product_id RESTRICT: un producto con línea vendida no se puede borrar', async () => {
    const sufijo = `restr-${Date.now()}`;
    const productId = await productoDePrueba(sufijo);
    const orden = await prisma.order.create({ data: ordenBase(sufijo) });
    await prisma.orderItem.create({
      data: {
        order_id: orden.id,
        product_id: productId,
        quantity: 1,
        unit_price_ars_cents: 100_000,
        product_name: 'Producto de prueba',
        product_sku: `ORDER-SCHEMA-${sufijo}`,
      },
    });

    // El catálogo archiva, no borra (design.md §2) — un producto con venta
    // registrada no puede desaparecer bajo una orden real.
    await expect(
      prisma.product.delete({ where: { id: productId } }),
    ).rejects.toThrow();
  });

  it('FK customer_id SET NULL: borrar la cuenta deja la orden viva sin dueño', async () => {
    const sufijo = `setnull-${Date.now()}`;
    const customer = await prisma.customer.create({
      data: {
        email: `order-setnull-${sufijo}@test.local`,
        password_hash: 'x'.repeat(60),
        name: 'Order SetNull',
      },
    });
    const orden = await prisma.order.create({
      data: { ...ordenBase(sufijo), customer_id: customer.id },
    });

    await prisma.customer.delete({ where: { id: customer.id } });

    const viva = await prisma.order.findUnique({ where: { id: orden.id } });
    expect(viva).not.toBeNull();
    expect(viva?.customer_id).toBeNull();
  });

  it('la migración del checkout no modificó ninguna tabla existente', async () => {
    // Ancla: el conjunto de columnas de `products` sigue conteniendo, como
    // mínimo, las que tenía antes de este change (mismo criterio que
    // cart-schema.spec.ts — `products` es compartida y sigue creciendo).
    const productos = await prisma.$queryRawUnsafe<
      Array<{ column_name: string }>
    >(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='products'`,
    );
    const ESPERADAS_MINIMO = [
      'id',
      'sku',
      'slug',
      'name',
      'description_raw',
      'price_ars_cents',
      'stock',
      'status',
      'category_id',
      'image_url',
      'created_at',
      'updated_at',
      'enrichment_done',
    ];
    const presentes = productos.map((f) => f.column_name);
    for (const columna of ESPERADAS_MINIMO) {
      expect(presentes).toContain(columna);
    }

    // Y que el índice HNSW de embeddings (US-005) + el GIN de búsqueda (US-004)
    // — los dos que Prisma intentó dropear por drift contra columnas
    // `Unsupported` al generar esta migración — siguen ahí.
    const indices = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
       AND indexname IN ('product_embeddings_embedding_hnsw_idx', 'products_search_document_gin_idx')`,
    );
    expect(indices.map((f) => f.indexname).sort()).toEqual([
      'product_embeddings_embedding_hnsw_idx',
      'products_search_document_gin_idx',
    ]);
  });
});
