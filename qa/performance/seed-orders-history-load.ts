import { writeFileSync } from 'node:fs';
import { PASSWORD_VALIDA } from '../support/customer-auth';
import { compraLogueada, sembrarProductoPublicado } from '../support/seed-order-history';

/**
 * QA-015-PERF-1 (`qa-plan.md` §7, `design.md` §D-QA7) — pre-seed Node/tsx
 * (fuera de k6 porque necesita Playwright/checkout real para producir cuentas
 * de cliente con órdenes reales, mismo patrón que `seed-orders-load.ts` de
 * US-012). Produce N cuentas de cliente REALES, cada una con exactamente 1
 * compra logueada confirmada (`compraLogueada`, §D-QA3), y escribe sus
 * credenciales a `data/orders-history-load-accounts.json` — el script de k6
 * lee ESE archivo con `open()` (nunca descubre cuentas por la API — la base
 * es compartida por otras sesiones QA en paralelo).
 *
 * Uso:
 *   QA_ORDERS_HISTORY_POOL_SIZE=20 pnpm --filter @dsm/qa exec tsx performance/seed-orders-history-load.ts
 */
interface CuentaDeCarga {
  email: string;
  password: string;
}

async function main(): Promise<void> {
  const n = Number(process.env.QA_ORDERS_HISTORY_POOL_SIZE ?? 20);
  const cuentas: CuentaDeCarga[] = [];
  for (let i = 0; i < n; i += 1) {
    const slug = await sembrarProductoPublicado();
    const compra = await compraLogueada(slug, `-carga-${Date.now()}-${i}`);
    cuentas.push({ email: compra.sesion.cuenta.email, password: PASSWORD_VALIDA });
    if ((i + 1) % 5 === 0) console.log(`  sembradas ${i + 1}/${n}`);
  }
  writeFileSync(
    new URL('./data/orders-history-load-accounts.json', import.meta.url),
    JSON.stringify(cuentas),
  );
  console.log(
    `OK: ${cuentas.length} cuentas con 1 compra confirmada c/u — pool escrito en ` +
      'data/orders-history-load-accounts.json',
  );
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
