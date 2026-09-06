import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { nuevaCategoria, nuevoProducto } from './builders';
import {
  adelantarProximoIntento,
  contarEmbeddings,
  disconnectEnrichmentDb,
  leerEstadoEnriquecimiento,
} from './enrichment-db';

const MARGEN_MS = 5_000;

async function main(): Promise<void> {
  const token = await adminAuth();
  const categoria = await apiCall<{ id: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );
  const producto = await apiCall<{ id: string }>(
    '/v1/admin/products',
    'POST',
    token,
    nuevoProducto(categoria.id),
  );

  const antes = await leerEstadoEnriquecimiento(producto.id);
  if (antes.enrichment_done !== false) {
    throw new Error('FAIL: un producto recién creado debería nacer con enrichment_done=false');
  }
  if (antes.enrichment_next_attempt_at !== null) {
    throw new Error('FAIL: un producto recién creado no debería tener enrichment_next_attempt_at');
  }

  await adelantarProximoIntento(producto.id);
  const despues = await leerEstadoEnriquecimiento(producto.id);

  if (despues.enrichment_next_attempt_at === null) {
    throw new Error('FAIL: adelantarProximoIntento no dejó enrichment_next_attempt_at seteado');
  }
  const delta = Date.now() - despues.enrichment_next_attempt_at.getTime();
  if (delta > MARGEN_MS || delta < -MARGEN_MS) {
    throw new Error(
      `FAIL: enrichment_next_attempt_at fuera de margen — delta=${delta}ms (esperado ~0, margen ${MARGEN_MS}ms)`,
    );
  }

  for (const campo of Object.keys(antes) as Array<keyof typeof antes>) {
    if (campo === 'enrichment_next_attempt_at') continue;
    if (JSON.stringify(antes[campo]) !== JSON.stringify(despues[campo])) {
      throw new Error(
        `FAIL: adelantarProximoIntento tocó la columna "${campo}" (antes=${JSON.stringify(antes[campo])}, después=${JSON.stringify(despues[campo])})`,
      );
    }
  }

  const embeddings = await contarEmbeddings();
  if (typeof embeddings !== 'number' || Number.isNaN(embeddings)) {
    throw new Error(`FAIL: contarEmbeddings() no devolvió un número, devolvió ${embeddings}`);
  }

  await disconnectEnrichmentDb();
  console.log(
    `OK: leerEstadoEnriquecimiento/adelantarProximoIntento/contarEmbeddings — producto ${producto.id}, embeddings totales=${embeddings}`,
  );
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
