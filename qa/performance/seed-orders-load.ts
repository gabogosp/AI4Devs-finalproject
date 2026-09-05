import { writeFileSync } from 'node:fs';
import { crearOrdenEnEstado } from '../support/seed-ordenes';

/**
 * Siembra el pool de órdenes en `new` que `orders-write.js` (TC-1241) consume,
 * una por iteración. Escribe los ids a `data/orders-load-pool.json` — el
 * script de k6 lee ESE archivo (con `open()`, `k6-load-scaffolding` no exige
 * descubrir por la API), nunca un `GET /v1/admin/orders?status=new` sin
 * acotar: la base es COMPARTIDA por otras sesiones QA en paralelo, y un
 * filtro por status devolvería también las órdenes de otras (mutar su estado
 * les rompería el test).
 *
 * Uso:
 *   QA_ORDERS_POOL_SIZE=200 pnpm --filter @dsm/qa exec tsx performance/seed-orders-load.ts
 */
async function main(): Promise<void> {
  const n = Number(process.env.QA_ORDERS_POOL_SIZE ?? 200);
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const orden = await crearOrdenEnEstado('new');
    ids.push(orden.id);
    if ((i + 1) % 20 === 0) console.log(`  sembradas ${i + 1}/${n}`);
  }
  writeFileSync(
    new URL('./data/orders-load-pool.json', import.meta.url),
    JSON.stringify(ids),
  );
  console.log(`OK: ${ids.length} órdenes en "new" — pool escrito en data/orders-load-pool.json`);
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
