import { PrismaClient } from '@dsm/db';

/**
 * T0.1 — reconciliación F40: el esquema materializado de `carts`/`cart_items` debe
 * tener **exactamente** las columnas, índices y constraints que declara
 * `design.md` §Persistencia. Espejo de `auth-schema.spec.ts`.
 *
 * Comparación por conjunto y no por subconjunto: falla si falta una columna **o si
 * sobra una**. Un test que sólo verificara "las que me importan están" dejaría pasar
 * la trampa de F40 al revés — una columna que el diseño nunca declaró, agregada al
 * pasar, sin decisión ni registro.
 *
 * Además de la forma, se prueba el **comportamiento** real: los dos `CHECK` (que
 * Prisma no declara y van a mano en el `migration.sql`) y las tres FKs con sus reglas
 * de borrado distintas — CASCADE, RESTRICT y SET NULL. Verificar el DDL sin ejercerlo
 * deja pasar el caso clásico: la constraint existe con la regla equivocada.
 */
const prisma = new PrismaClient();

const ESPERADO: Record<string, string[]> = {
  carts: [
    'id',
    'session_token_hash',
    'customer_id',
    'expires_at',
    'created_at',
    'updated_at',
  ],
  cart_items: [
    'id',
    'cart_id',
    'product_id',
    'quantity',
    'unit_price_ars_cents',
    'created_at',
    'updated_at',
  ],
};

const INDICES_ESPERADOS: Record<string, string[]> = {
  carts: [
    'carts_session_token_hash_key',
    'carts_expires_at_idx',
    'carts_customer_id_idx',
  ],
  cart_items: ['cart_items_cart_id_product_id_key', 'cart_items_cart_id_idx'],
};

const enTreintaDias = () => new Date(Date.now() + 30 * 86_400_000);

/** Categoría + producto publicado mínimos para colgarles una línea de carrito. */
async function productoDePrueba(sufijo: string): Promise<string> {
  const categoria = await prisma.category.create({
    data: { name: `Cat ${sufijo}`, slug: `cat-schema-${sufijo}` },
  });
  const producto = await prisma.product.create({
    data: {
      sku: `CART-SCHEMA-${sufijo}`,
      slug: `cart-schema-${sufijo}`,
      name: 'Producto de prueba',
      price_ars_cents: 100_000,
      stock: 5,
      status: 'published',
      category_id: categoria.id,
    },
  });
  return producto.id;
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Esquema del carrito materializado (F40 — reconciliación con design.md)', () => {
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

  it('cart_items declara los dos CHECK que el diseño exige', async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
      `SELECT c.conname FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'cart_items' AND c.contype = 'c'`,
    );
    const nombres = filas.map((f) => f.conname);
    expect(nombres).toContain('cart_items_quantity_check');
    expect(nombres).toContain('cart_items_unit_price_check');
  });

  it('CHECK (quantity >= 1): una línea con cantidad 0 la rechaza la BASE', async () => {
    const productId = await productoDePrueba(`qty-${Date.now()}`);
    const cart = await prisma.cart.create({
      data: {
        session_token_hash: `h-qty-${Date.now()}`,
        expires_at: enTreintaDias(),
      },
    });

    await expect(
      prisma.cartItem.create({
        data: {
          cart_id: cart.id,
          product_id: productId,
          quantity: 0,
          unit_price_ars_cents: 100_000,
        },
      }),
    ).rejects.toThrow();
  });

  it('CHECK (unit_price_ars_cents >= 0): un precio negativo lo rechaza la BASE', async () => {
    const productId = await productoDePrueba(`price-${Date.now()}`);
    const cart = await prisma.cart.create({
      data: {
        session_token_hash: `h-price-${Date.now()}`,
        expires_at: enTreintaDias(),
      },
    });

    await expect(
      prisma.cartItem.create({
        data: {
          cart_id: cart.id,
          product_id: productId,
          quantity: 1,
          unit_price_ars_cents: -1,
        },
      }),
    ).rejects.toThrow();
  });

  it('UNIQUE (cart_id, product_id): dos líneas del mismo producto no coexisten', async () => {
    const productId = await productoDePrueba(`uniq-${Date.now()}`);
    const cart = await prisma.cart.create({
      data: {
        session_token_hash: `h-uniq-${Date.now()}`,
        expires_at: enTreintaDias(),
      },
    });
    const linea = {
      cart_id: cart.id,
      product_id: productId,
      quantity: 1,
      unit_price_ars_cents: 100_000,
    };
    await prisma.cartItem.create({ data: linea });

    await expect(prisma.cartItem.create({ data: linea })).rejects.toThrow();
  });

  it('FK cart_id CASCADE: borrar un carrito se lleva sus líneas', async () => {
    const productId = await productoDePrueba(`casc-${Date.now()}`);
    const cart = await prisma.cart.create({
      data: {
        session_token_hash: `h-casc-${Date.now()}`,
        expires_at: enTreintaDias(),
      },
    });
    await prisma.cartItem.create({
      data: {
        cart_id: cart.id,
        product_id: productId,
        quantity: 2,
        unit_price_ars_cents: 100_000,
      },
    });

    await prisma.cart.delete({ where: { id: cart.id } });

    expect(await prisma.cartItem.count({ where: { cart_id: cart.id } })).toBe(0);
  });

  it('FK product_id RESTRICT: un producto con línea viva no se puede borrar', async () => {
    const productId = await productoDePrueba(`restr-${Date.now()}`);
    const cart = await prisma.cart.create({
      data: {
        session_token_hash: `h-restr-${Date.now()}`,
        expires_at: enTreintaDias(),
      },
    });
    await prisma.cartItem.create({
      data: {
        cart_id: cart.id,
        product_id: productId,
        quantity: 1,
        unit_price_ars_cents: 100_000,
      },
    });

    // Es lo que hace innecesario manejar líneas huérfanas (design.md §Decisión 4).
    await expect(
      prisma.product.delete({ where: { id: productId } }),
    ).rejects.toThrow();
  });

  it('FK customer_id SET NULL: borrar la cuenta anonimiza el carrito, no lo borra', async () => {
    const customer = await prisma.customer.create({
      data: {
        email: `cart-setnull-${Date.now()}@test.local`,
        password_hash: 'x'.repeat(60),
        name: 'Cart SetNull',
      },
    });
    const cart = await prisma.cart.create({
      data: {
        session_token_hash: `h-setnull-${Date.now()}`,
        customer_id: customer.id,
        expires_at: enTreintaDias(),
      },
    });

    await prisma.customer.delete({ where: { id: customer.id } });

    const vivo = await prisma.cart.findUnique({ where: { id: cart.id } });
    expect(vivo).not.toBeNull();
    expect(vivo?.customer_id).toBeNull();
  });

  it('la migración del carrito no modificó ninguna tabla existente', async () => {
    // El diseño declara la migración como puramente aditiva. El ancla es el
    // conjunto EXACTO de columnas de `products` (la tabla que el carrito referencia):
    // si alguien le agregara una columna "de paso" al implementar el carrito, falla.
    const productos = await prisma.$queryRawUnsafe<
      Array<{ column_name: string }>
    >(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='products'`,
    );
    expect(productos.map((f) => f.column_name).sort()).toEqual(
      [
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
        'enrichment_done', // US-006
      ].sort(),
    );
  });
});
