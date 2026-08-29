import { MIN_SKUS } from '../lib/thresholds.js';

/**
 * Generador determinista de ≥5.000 SKUs para la carga. Sin Math.random/Date.now:
 * los SKUs derivan del índice, con un prefijo de corrida inyectado por env para
 * idempotencia entre runs (no se asertan valores, sólo el volumen).
 */
export function generateSkus(count = MIN_SKUS, runPrefix = 'LOAD') {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const n = String(i).padStart(5, '0');
    rows.push({
      sku: `${runPrefix}-${n}`,
      name: `Producto de carga ${n}`,
      price_ars_cents: 1000 + i,
      stock: i % 500,
    });
  }
  return rows;
}

export default { generateSkus, MIN_SKUS };
