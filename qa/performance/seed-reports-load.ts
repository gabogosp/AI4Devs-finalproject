import { adminAuth } from '../support/admin-auth';
import { catalogoParaMetricas, crearOrdenActiva, type FulfillmentStatus } from '../support/seed-metricas';

/**
 * Siembra el dataset que `reports-read.js` (QA-016-PERF-1) lee: órdenes
 * ACTIVAS reales (checkout + confirm-payment + PATCH, nunca INSERT directo,
 * mismo criterio que `seed-metricas.ts`) sobre un catálogo chico, un volumen
 * representativo del riesgo declarado en qa-plan.md §1 (~100 órdenes/mes),
 * no un stress artificial — la superficie es de bajo tráfico a propósito.
 *
 * Uso:
 *   QA_REPORTS_POOL_SIZE=100 pnpm --filter @dsm/qa exec tsx performance/seed-reports-load.ts
 */
const ESTADOS: FulfillmentStatus[] = ['new', 'preparing', 'ready', 'delivered'];

async function main(): Promise<void> {
  const n = Number(process.env.QA_REPORTS_POOL_SIZE ?? 100);
  const token = await adminAuth();
  const catalogo = await catalogoParaMetricas(10, { token });

  for (let i = 0; i < n; i += 1) {
    const producto = catalogo.productos[i % catalogo.productos.length]!;
    const estado = ESTADOS[i % ESTADOS.length]!;
    await crearOrdenActiva(estado, {
      adminToken: token,
      catalogo,
      items: [
        {
          slug: producto.slug,
          quantity: 1,
          priceArsCents: producto.price_ars_cents,
          productName: producto.name,
          productId: producto.id,
        },
      ],
    });
    if ((i + 1) % 20 === 0) console.log(`  sembradas ${i + 1}/${n}`);
  }
  console.log(`OK: ${n} órdenes activas sembradas para la carga de lectura de reports/*`);
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
