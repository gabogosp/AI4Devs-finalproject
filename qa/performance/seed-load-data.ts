// `@dsm/db` es CJS y `@dsm/qa` es ESM: los named exports no son analizables
// estáticamente, así que se toma el default y se destructura.
import db from '@dsm/db';
import { generateSkus } from './data/seed-skus.js';

const { PrismaClient } = db as unknown as { PrismaClient: new () => any };
import { MIN_SKUS } from './lib/thresholds.js';

/**
 * Siembra el dataset de carga (≥5.000 SKUs) que exige el NFR de US-001 §9.
 *
 * Por qué existe: `baseline.js` sólo hace login en `setup()`; nada creaba las
 * filas, así que la suite de carga dependía de una base sembrada a mano y
 * cualquier corrida de los e2e del backend (que hacen `TRUNCATE products,
 * categories`) la dejaba en cero. Sin esto la suite **no es reproducible** ni
 * en local ni en CI.
 *
 * Inserta por SQL (bulk) en vez de por API: son 5.000 filas de **fixture de
 * volumen**, no de comportamiento — la API ya se ejercita en las otras capas.
 *
 * Idempotente: `skipDuplicates` sobre el índice único de `sku`.
 */
const CATEGORY_SLUG = 'carga-qa';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const category = await prisma.category.upsert({
      where: { slug: CATEGORY_SLUG },
      update: {},
      create: { slug: CATEGORY_SLUG, name: 'Carga QA' },
    });

    const rows = generateSkus(MIN_SKUS, 'LOAD').map((r) => ({
      ...r,
      status: 'published',
      category_id: category.id,
    }));

    const { count } = await prisma.product.createMany({
      data: rows,
      skipDuplicates: true,
    });

    const total = await prisma.product.count();
    console.log(
      `seed-load-data: +${count} insertados · total en catálogo: ${total} (mínimo exigido: ${MIN_SKUS})`,
    );
    if (total < MIN_SKUS) {
      console.error(
        `FAIL: el catálogo tiene ${total} productos, el NFR exige ≥ ${MIN_SKUS}`,
      );
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('seed-load-data FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
