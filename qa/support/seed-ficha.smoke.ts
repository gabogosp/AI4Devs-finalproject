import { seedFichaPublica } from './seed-ficha';

/** Smoke de T1.1: siembra los cinco estados y reporta sus identificadores. */
async function main(): Promise<void> {
  const s = await seedFichaPublica();

  const filas: Array<[string, { slug: string; sku: string }]> = [
    ['publicado ', s.publicado],
    ['sin stock ', s.sinStock],
    ['sin imagen', s.sinImagen],
    ['draft     ', s.draft],
    ['archivado ', s.archivado],
  ];

  for (const [etiqueta, p] of filas) {
    if (!p.slug) throw new Error(`${etiqueta.trim()}: sin slug derivado`);
    console.log(`  ${etiqueta}  slug=${p.slug}  sku=${p.sku}`);
  }

  const slugs = new Set(filas.map(([, p]) => p.slug));
  if (slugs.size !== filas.length) {
    throw new Error('slugs duplicados entre los productos sembrados');
  }

  console.log(`OK: 5 estados sembrados en la categoría ${s.categoryId}`);
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
