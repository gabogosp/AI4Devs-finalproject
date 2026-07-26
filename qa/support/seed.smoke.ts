import { seedCatalogo } from './seed';

/**
 * Smoke del seed: siembra vía la API real y verifica que devuelve ids; una
 * segunda siembra en la misma corrida no colisiona (prefijo único por-run +
 * secuencia). Prueba el camino real de alta (no INSERT directo).
 */
async function main(): Promise<void> {
  const first = await seedCatalogo(2);
  if (!first.categoryId || first.productIds.length !== 2) {
    throw new Error('la primera siembra no devolvió ids esperados');
  }
  const second = await seedCatalogo(1);
  if (!second.categoryId || second.productIds.length !== 1) {
    throw new Error('la segunda siembra falló (colisión / no idempotente)');
  }
  console.log(
    `OK: seed vía API — cat ${first.categoryId.slice(0, 8)}… + ${first.productIds.length + second.productIds.length} productos, sin colisión`,
  );
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
