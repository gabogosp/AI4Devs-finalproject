import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import { sembrarLotePendiente, sembrarProductoDraft } from './seed-enrichment';

async function estadoDe(token: string, id: string): Promise<{ status: string; description_raw: string | null }> {
  return apiCall<{ status: string; description_raw: string | null }>(
    `/v1/admin/products/${id}`,
    'GET',
    token,
  );
}

async function main(): Promise<void> {
  const token = await adminAuth();

  const lote = await sembrarLotePendiente(3);
  if (lote.length !== 3) {
    throw new Error(`FAIL: se esperaban 3 productos, se sembraron ${lote.length}`);
  }
  const ids = new Set(lote.map((p) => p.id));
  if (ids.size !== 3) throw new Error('FAIL: ids duplicados en el lote sembrado');

  for (const p of lote) {
    const estado = await estadoDe(token, p.id);
    if (estado.status !== 'published') {
      throw new Error(`FAIL: producto ${p.id} esperado "published", llegó "${estado.status}"`);
    }
    if (!estado.description_raw || estado.description_raw.length >= 20) {
      throw new Error(
        `FAIL: producto ${p.id} no tiene una description_raw "pobre" (< 20 chars): "${estado.description_raw}"`,
      );
    }
  }

  const draft = await sembrarProductoDraft();
  const estadoDraft = await estadoDe(token, draft.id);
  if (estadoDraft.status !== 'draft') {
    throw new Error(`FAIL: producto draft ${draft.id} esperado "draft", llegó "${estadoDraft.status}"`);
  }

  console.log(
    `OK: 3 pendientes publicados (${[...ids].join(', ')}) + 1 draft (${draft.id}) sembrados correctamente`,
  );
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
