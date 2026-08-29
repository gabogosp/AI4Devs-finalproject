import { QA_API_BASE_URL } from './qa-env';

const API = QA_API_BASE_URL;

export interface ImportRowError {
  row_number: number;
  sku: string | null;
  field: string | null;
  error_code: string;
  error_message: string;
}

export interface ImportJob {
  id: string;
  status: string;
  filename: string;
  source_format: string;
  total_rows: number | null;
  processed_rows: number;
  created_count: number;
  updated_count: number;
  failed_count: number;
  categories_created_count: number;
  error_code: string | null;
  error_message: string | null;
  report_truncated: boolean;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  errors: ImportRowError[];
  pagination: { limit: number; offset: number; total: number };
}

export interface Respuesta<T> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * `POST /v1/admin/imports`. Multipart armado con `FormData` + `Blob` del
 * runtime de Node (no a mano): es lo mismo que arma un navegador, y es la
 * costura que un mutator ya rompió una vez forzando `content-type:
 * application/json` sobre un `FormData` (E-1 del `qa-plan.md`).
 *
 * Nunca lanza por status ≠ 2xx: los escenarios corner/negative necesitan leer
 * el cuerpo RFC 7807 del rechazo (422/413/415/401/403/409), así que el llamador
 * decide qué status es aceptable.
 */
export async function subirImport(
  token: string | undefined,
  buffer: Buffer,
  filename: string,
  opts: { idempotencyKey?: string } = {},
): Promise<Respuesta<{ id?: string; status?: string; type?: string; title?: string; detail?: string }>> {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);

  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

  const res = await fetch(`${API}/v1/admin/imports`, {
    method: 'POST',
    headers,
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

/** `GET /v1/admin/imports/:id`. */
export async function estadoImport(
  token: string,
  id: string,
  page: { limit?: number; offset?: number } = {},
): Promise<Respuesta<ImportJob>> {
  const qs = new URLSearchParams();
  if (page.limit !== undefined) qs.set('limit', String(page.limit));
  if (page.offset !== undefined) qs.set('offset', String(page.offset));
  const suffix = qs.toString() ? `?${qs}` : '';
  const res = await fetch(`${API}/v1/admin/imports/${id}${suffix}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as ImportJob;
  return { status: res.status, body, headers: res.headers };
}

const TERMINALES = new Set(['completed', 'failed']);

/**
 * La assertion de espera de toda la suite: `expect.poll` por condición
 * (`status ∈ {completed, failed}`), nunca `waitForTimeout`. El timeout es **por
 * tamaño**: un archivo de pocas filas termina en milisegundos, uno de 5.000
 * corre en lotes de `IMPORT_BATCH_SIZE` (200) y puede tardar decenas de
 * segundos.
 *
 * El mensaje de fallo trae `status` y `error_code`: sin eso, un timeout dice
 * sólo "se agotó el tiempo" y no por qué el trabajo no llegó a terminal.
 */
export async function esperarTrabajo(
  token: string,
  id: string,
  { timeoutMs = 20_000, intervalMs = 200 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ImportJob> {
  const limite = Date.now() + timeoutMs;
  let ultimo: ImportJob | undefined;
  let ultimoProcessed = -1;
  while (Date.now() < limite) {
    const { body } = await estadoImport(token, id);
    ultimo = body;
    if (ultimo.processed_rows < ultimoProcessed) {
      throw new Error(
        `[qa/import] processed_rows retrocedió de ${ultimoProcessed} a ${ultimo.processed_rows} en el trabajo ${id}: el progreso tiene que ser monótono`,
      );
    }
    ultimoProcessed = ultimo.processed_rows;
    if (TERMINALES.has(ultimo.status)) return ultimo;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `[qa/import] el trabajo ${id} no llegó a un estado terminal en ${timeoutMs}ms ` +
      `(status=${ultimo?.status ?? 'desconocido'}, error_code=${ultimo?.error_code ?? 'ninguno'}, ` +
      `processed=${ultimo?.processed_rows ?? '?'}/${ultimo?.total_rows ?? '?'})`,
  );
}

/** `GET /v1/admin/imports/:id/report`. Devuelve el texto CSV y el nombre del `Content-Disposition`. */
export async function bajarReporte(
  token: string,
  id: string,
): Promise<{ status: number; texto: string; filename: string | null }> {
  const res = await fetch(`${API}/v1/admin/imports/${id}/report`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const texto = await res.text();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  return { status: res.status, texto, filename: match?.[1] ?? null };
}
