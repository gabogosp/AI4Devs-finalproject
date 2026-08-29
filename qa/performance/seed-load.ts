import pkg from '@prisma/client';
import { generateSkus } from './data/seed-skus.js';

const { PrismaClient } = pkg;

/**
 * Sembrado del dataset de CARGA (≥5.000 SKUs) — bulk vía Prisma directo. Es
 * SETUP de la prueba de carga (no el camino de negocio bajo prueba: eso lo hace
 * el seed vía API en support/seed.ts). Idempotente: reusa/crea una categoría de
 * carga y hace createMany con skipDuplicates.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const slug = 'carga-load';
    const category =
      (await prisma.category.findUnique({ where: { slug } })) ??
      (await prisma.category.create({
        data: { name: 'Carga (load)', slug },
      }));

    const rows = generateSkus(5000, 'LOAD').map((r) => ({
      sku: r.sku,
      name: r.name,
      price_ars_cents: r.price_ars_cents,
      stock: r.stock,
      status: 'published',
      category_id: category.id,
    }));

    const res = await prisma.product.createMany({
      data: rows,
      skipDuplicates: true,
    });

    const total = await prisma.product.count();
    console.log(
      `OK: dataset de carga — +${res.count} nuevos, total productos en DB = ${total}`,
    );
    if (total < 5000) {
      throw new Error(`total ${total} < 5000`);
    }
  } finally {
    await (async () => {})();
  }
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
