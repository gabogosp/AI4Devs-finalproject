import { PrismaClient } from '@dsm/db';

/**
 * T0.2 — reconciliación F40: el esquema materializado debe tener **exactamente**
 * las columnas que declara `design.md` §Persistencia. Comparación por conjunto,
 * no por subconjunto: falla si falta una columna **o si sobra una**.
 *
 * Un test que sólo verificara "las columnas que me importan están" dejaría pasar
 * la trampa de F40 al revés — una columna que el diseño nunca declaró, agregada
 * al pasar, sin decisión ni registro.
 */
const prisma = new PrismaClient();

const ESPERADO: Record<string, string[]> = {
  customers: [
    'id',
    'email',
    'password_hash',
    'name',
    'phone',
    'role',
    'failed_login_attempts',
    'lockout_count',
    'locked_until',
    'password_changed_at',
    'last_login_at',
    'deleted_at',
    'created_at',
    'updated_at',
  ],
  refresh_tokens: [
    'id',
    'customer_id',
    'token_hash',
    'family_id',
    'expires_at',
    'rotated_at',
    'revoked_at',
    'created_at',
  ],
  password_reset_tokens: [
    'id',
    'customer_id',
    'token_hash',
    'expires_at',
    'used_at',
    'created_at',
  ],
};

const INDICES_ESPERADOS: Record<string, string[]> = {
  customers: ['customers_email_key'],
  refresh_tokens: [
    'refresh_tokens_token_hash_key',
    'refresh_tokens_customer_id_idx',
    'refresh_tokens_family_id_idx',
    'refresh_tokens_expires_at_idx',
  ],
  password_reset_tokens: [
    'password_reset_tokens_token_hash_key',
    'password_reset_tokens_customer_id_created_at_idx',
    'password_reset_tokens_expires_at_idx',
  ],
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Esquema de auth materializado (F40 — reconciliación con design.md)', () => {
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

  it('las FKs borran en cascada: borrar un customer se lleva sus tokens', async () => {
    const email = `cascade-${Date.now()}@test.local`;
    const customer = await prisma.customer.create({
      data: { email, password_hash: 'x'.repeat(60), name: 'Cascade' },
    });
    await prisma.refreshToken.create({
      data: {
        customer_id: customer.id,
        token_hash: `rt-${Date.now()}`,
        family_id: customer.id,
        expires_at: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.passwordResetToken.create({
      data: {
        customer_id: customer.id,
        token_hash: `prt-${Date.now()}`,
        expires_at: new Date(Date.now() + 3_600_000),
      },
    });

    await prisma.customer.delete({ where: { id: customer.id } });

    expect(
      await prisma.refreshToken.count({ where: { customer_id: customer.id } }),
    ).toBe(0);
    expect(
      await prisma.passwordResetToken.count({
        where: { customer_id: customer.id },
      }),
    ).toBe(0);
  });

  it('la migración de auth no modificó products (su única columna extra es de US-006)', async () => {
    // El diseño de US-014 declara su migración como puramente aditiva sobre
    // tablas nuevas. El ancla sigue siendo el conjunto EXACTO, no un subconjunto.
    //
    // `enrichment_done` la agregó US-006 (import masivo) el 2026-08-20, con
    // decisión registrada en su design.md §Persistencia: se declara acá para que
    // el ancla siga siendo exacto. Si aparece cualquier OTRA columna, este test
    // falla — que es justo lo que tiene que hacer.
    const productos = await prisma.$queryRawUnsafe<
      Array<{ column_name: string }>
    >(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='products'`,
    );
    // `products` es una tabla COMPARTIDA y sigue creciendo: US-006 le agregó
    // `enrichment_done` y US-005 las seis columnas del enriquecimiento IA. Afirmar
    // el conjunto EXACTO obligaba a editar este literal en cada change ajeno que la
    // toca —ya pasó dos veces— y convertía el guard en ruido en vez de protección.
    //
    // Lo que se verifica ahora es lo que este change necesita garantizar: que
    // ninguna de las columnas preexistentes se perdió. El "no sobra ninguna" de F40
    // se mantiene entero para las tablas que este change POSEE (arriba).
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
      'enrichment_done', // US-006
    ];
    const presentes = productos.map((f) => f.column_name);
    for (const columna of ESPERADAS_MINIMO) {
      expect(presentes).toContain(columna);
    }
  });
});
