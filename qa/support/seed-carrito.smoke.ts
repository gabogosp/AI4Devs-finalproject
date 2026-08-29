import { seedCarrito, STOCK_INVARIANTE } from './seed-carrito';
import { adminAuth } from './admin-auth';
import { apiCall } from './api';

/** Smoke de T1.1: siembra las siete fixturas y verifica lo que los escenarios asumen. */
async function main(): Promise<void> {
  const s = await seedCarrito();

  const filas: Array<[string, { slug: string; sku: string; id: string }]> = [
    ['stock 3         ', s.stockTres],
    ['mixto A         ', s.mixtoA],
    ['mixto B         ', s.mixtoB],
    ['para despublicar', s.paraDespublicar],
    ['para precio     ', s.paraCambiarPrecio],
    ['draft           ', s.draft],
    ['archivado       ', s.archivado],
  ];

  for (const [etiqueta, p] of filas) {
    if (!p.slug) throw new Error(`${etiqueta.trim()}: sin slug derivado`);
    console.log(`  ${etiqueta}  slug=${p.slug}`);
  }

  const slugs = new Set(filas.map(([, p]) => p.slug));
  if (slugs.size !== filas.length) {
    throw new Error('slugs duplicados entre los productos sembrados');
  }

  // El stock de la invariante tiene que ser EXACTAMENTE 3, no "alguno": con un
  // stock alto, tres invitados entrarían igual y N-2 no distinguiría un carrito
  // que reserva de uno que no.
  const token = await adminAuth();
  const real = await apiCall<{ stock: number; status: string }>(
    `/v1/admin/products/${s.stockTres.id}`,
    'GET',
    token,
  );
  if (real.stock !== STOCK_INVARIANTE) {
    throw new Error(
      `la invariante de AC-8 exige stock ${STOCK_INVARIANTE}, se sembró ${real.stock}`,
    );
  }
  if (real.status !== 'published') {
    throw new Error(`el producto de la invariante quedó en ${real.status}`);
  }

  // Los estados no publicables tienen que estar en el estado que dicen.
  for (const [etiqueta, p, esperado] of [
    ['draft', s.draft, 'draft'],
    ['archivado', s.archivado, 'archived'],
  ] as const) {
    const dto = await apiCall<{ status: string }>(
      `/v1/admin/products/${p.id}`,
      'GET',
      token,
    );
    if (dto.status !== esperado) {
      throw new Error(`${etiqueta}: se esperaba ${esperado}, quedó ${dto.status}`);
    }
  }

  console.log(
    `OK: 7 fixturas sembradas en la categoría ${s.categoryId} (invariante stock=${real.stock})`,
  );
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
