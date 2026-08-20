import { PrismaClient } from '@dsm/db';

/**
 * T0.2 — reconciliación F40 del esquema de import. Espejo de
 * `auth-schema.spec.ts`: compara el conjunto **completo** de columnas contra lo
 * que declara `design.md` §Persistencia, así que falla si falta una columna
 * **o si sobra una**. Una columna agregada al pasar, sin decisión ni registro,
 * es la trampa de F40 al revés.
 */
const prisma = new PrismaClient();

const ESPERADO: Record<string, string[]> = {
  import_jobs: [
    'id',
    'status',
    'filename',
    'file_size_bytes',
    'source_format',
    'idempotency_key',
    'created_by_subject',
    'total_rows',
    'processed_rows',
    'created_count',
    'updated_count',
    'failed_count',
    'categories_created_count',
    'error_code',
    'error_message',
    'report_truncated',
    'started_at',
    'finished_at',
    'heartbeat_at',
    'created_at',
    'updated_at',
  ],
  import_job_rows: [
    'id',
    'job_id',
    'row_number',
    'sku',
    'field',
    'error_code',
    'error_message',
    'created_at',
  ],
};

const INDICES_ESPERADOS: Record<string, string[]> = {
  import_jobs: [
    'import_jobs_idempotency_key_key',
    'import_jobs_status_idx',
    'import_jobs_created_at_idx',
  ],
  import_job_rows: ['import_job_rows_job_id_row_number_idx'],
};

/** `products` tras US-006: las 12 de US-001/US-003 más `enrichment_done`. */
const PRODUCTS_ESPERADO = [
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

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Esquema de import materializado (F40 — reconciliación con design.md)', () => {
  for (const [tabla, columnas] of Object.entries(ESPERADO)) {
    it(`${tabla}: tiene exactamente las ${columnas.length} columnas declaradas`, async () => {
      const filas = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        tabla,
      );
      expect(filas.map((f) => f.column_name).sort()).toEqual(
        [...columnas].sort(),
      );
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

  it('products pasa de 12 a 13 columnas, con enrichment_done en false por default', async () => {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ column_name: string; column_default: string | null; is_nullable: string }>
    >(
      `SELECT column_name, column_default, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='products'`,
    );

    expect(filas.map((f) => f.column_name).sort()).toEqual(
      [...PRODUCTS_ESPERADO].sort(),
    );

    const columna = filas.find((f) => f.column_name === 'enrichment_done');
    expect(columna?.is_nullable).toBe('NO');
    expect(columna?.column_default).toBe('false');
  });

  it('un producto creado sin declarar enrichment_done nace en false', async () => {
    const categoria = await prisma.category.create({
      data: { name: `Import ${Date.now()}`, slug: `import-${Date.now()}` },
    });
    const producto = await prisma.product.create({
      data: {
        sku: `IMP-${Date.now()}`,
        slug: `imp-${Date.now()}`,
        name: 'Producto de prueba',
        price_ars_cents: 1000,
        category_id: categoria.id,
      },
    });

    expect(producto.enrichment_done).toBe(false);

    await prisma.product.delete({ where: { id: producto.id } });
    await prisma.category.delete({ where: { id: categoria.id } });
  });

  it('borrar un job se lleva sus filas de error en cascada', async () => {
    const job = await prisma.importJob.create({
      data: {
        filename: 'catalogo.csv',
        file_size_bytes: 1024,
        source_format: 'csv',
      },
    });
    await prisma.importJobRow.createMany({
      data: [
        {
          job_id: job.id,
          row_number: 3,
          sku: 'REF-001',
          field: 'price_ars_cents',
          error_code: 'invalid_number',
          error_message: 'El precio debe ser un número mayor a cero',
        },
        {
          job_id: job.id,
          row_number: 7,
          error_code: 'missing_sku',
          error_message: 'La fila no trae SKU',
        },
      ],
    });

    await prisma.importJob.delete({ where: { id: job.id } });

    expect(await prisma.importJobRow.count({ where: { job_id: job.id } })).toBe(
      0,
    );
  });

  it('idempotency_key es único: dos jobs con la misma clave no coexisten', async () => {
    const clave = `idem-${Date.now()}`;
    const base = {
      filename: 'catalogo.csv',
      file_size_bytes: 10,
      source_format: 'csv',
      idempotency_key: clave,
    };
    const primero = await prisma.importJob.create({ data: base });

    await expect(prisma.importJob.create({ data: base })).rejects.toBeTruthy();

    await prisma.importJob.delete({ where: { id: primero.id } });
  });

  it('categories no fue modificada por esta migración', async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='categories'`,
    );
    expect(filas.map((f) => f.column_name).sort()).toEqual(
      ['id', 'slug', 'name', 'parent_id', 'created_at'].sort(),
    );
  });
});
