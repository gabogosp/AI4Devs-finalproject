import { parseContract } from '@/lib/http/contract';
import {
  createImport,
  getImport,
  getImportReport,
} from '@/api/generated/endpoints';
import {
  CreateImportResponse,
  GetImportResponse,
} from '@/api/generated/zod';
import type {
  ImportCreated,
  ImportJob,
  ImportRowError,
} from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO — generados desde `apps/api/docs/api/openapi.yaml`
 * (`frontend-standards.md` §3.1/§3.2). Nunca se declaran a mano: un tipo escrito
 * a mano queda verde contra el contrato viejo, que es justo lo que pasó con este
 * import cuando el backend renombró `name_too_long` a `invalid_text`.
 */
export type { ImportCreated, ImportJob, ImportRowError };

/** Página de filas rechazadas. El default (50) es el mismo que el del servidor. */
export const REPORT_PAGE_SIZE = 50;

export interface ReportFile {
  /** Contenido del CSV, tal como lo generó el servidor. */
  csv: string;
  /**
   * Nombre que el **servidor** eligió (`Content-Disposition`). No se construye
   * en el cliente: `security-standards.md` §6.4 — server-generated storage names.
   */
  filename: string;
}

/** `import-{id}-errores.csv` del header; si no viniera, un nombre honesto de respaldo. */
function nombreDelHeader(headers: Headers, id: string): string {
  const disposition = headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return match?.[1] ?? `import-${id}-errores.csv`;
}

/**
 * Lógica de servicio del import masivo (`frontend-standards` §3.3 — lo único que
 * se escribe a mano). La red va por las **operaciones generadas** (F48): el
 * cliente generado sólo puede nombrar endpoints que el contrato declara, así que
 * una ruta fuera de contrato es estructuralmente imposible. La respuesta se valida
 * en el borde con los schemas Zod generados.
 *
 * Todo pasa por el mutator único (§8), así que `Authorization` (el panel usa
 * Bearer en memoria), `traceparent`, el timeout y la traducción RFC 7807 se
 * heredan sin repetirlos acá.
 */
export const importsService = {
  /**
   * Sube el archivo y devuelve el trabajo creado.
   *
   * `Idempotency-Key` la elige el llamador y **no** se genera acá a propósito: la
   * clave tiene que sobrevivir a un reintento del mismo archivo, así que su ciclo
   * de vida es el de la selección del archivo, no el de esta llamada
   * (`api-standards` §10).
   */
  async create(
    file: File,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ImportCreated> {
    const res = await createImport(
      { file },
      { signal, headers: { 'idempotency-key': idempotencyKey } },
    );
    return parseContract(CreateImportResponse, res.data);
  },

  /**
   * Estado del trabajo con sus filas rechazadas paginadas.
   *
   * El `limit`/`offset` viajan explícitos aunque coincidan con los defaults del
   * servidor: la paginación de la tabla es del cliente, y depender de un default
   * ajeno haría que un cambio en el backend moviera la UI sin aviso.
   */
  async get(
    id: string,
    page: { limit: number; offset: number } = {
      limit: REPORT_PAGE_SIZE,
      offset: 0,
    },
    signal?: AbortSignal,
  ): Promise<ImportJob> {
    const res = await getImport(id, page, { signal });
    return parseContract(GetImportResponse, res.data);
  },

  /**
   * Descarga el CSV del reporte.
   *
   * Devuelve el **texto** y el nombre del servidor; disparar la descarga es
   * trabajo de la UI (`reportDownload.ts`). Separarlo es lo que permite testear
   * esto sin `URL.createObjectURL`.
   *
   * El schema Zod del reporte es `unknown()` —el contrato declara `text/csv`, no
   * un objeto—, así que acá no hay nada que validar: lo que se verifica es que el
   * cuerpo llegó como texto.
   */
  async downloadReport(id: string, signal?: AbortSignal): Promise<ReportFile> {
    const res = await getImportReport(id, { signal });
    const csv = typeof res.data === 'string' ? res.data : String(res.data ?? '');
    return { csv, filename: nombreDelHeader(res.headers, id) };
  },
};
