import type { AppError } from '@/lib/http/errors';

/**
 * Traducción de los **dos** catálogos de error del import, que la pantalla no
 * mezcla porque significan cosas distintas:
 *
 * - **Nivel archivo** (`type` RFC 7807): el `POST` falló y **nada** se escribió.
 * - **Nivel fila** (`error_code`): el trabajo corrió y esas filas quedaron afuera.
 *
 * Los dos mapas usan **acceso por índice con fallback explícito** y no un `switch`
 * exhaustivo sobre un union type (`frontend-standards.md` §11.3). Es deliberado:
 * el backend puede agregar un código —ya pasó, renombró `name_too_long` a
 * `invalid_text`— y con un `switch` sobre un enum eso sería una pantalla vacía en
 * vez de un texto menos pulido.
 */

/** Copy del rechazo del archivo entero. Termina siempre en «el catálogo no se tocó» (AC-6). */
const COPY_ARCHIVO: Record<string, string> = {
  'dsm:import/file-too-large':
    'El archivo pesa más de 4 MiB. Partilo en dos y subilos de a uno.',
  'dsm:import/unsupported-format':
    'El archivo no es un CSV ni un Excel (.xlsx) válido. Si lo exportaste de otro sistema, guardalo como CSV UTF-8.',
  'dsm:import/missing-columns':
    'Al archivo le faltan columnas obligatorias.',
  'dsm:import/row-limit-exceeded':
    'El archivo supera las 5.000 filas. Partilo en archivos más chicos y subilos de a uno.',
  'dsm:import/invalid-encoding':
    'El archivo no está en UTF-8 y los acentos se leerían mal. Guardalo como «CSV UTF-8» y volvé a subirlo.',
  'dsm:import/already-running':
    'Hay una importación en curso. Esperá a que termine antes de subir otro archivo.',
  'dsm:import/not-found':
    'Esa importación no existe o ya se purgó (se guardan 90 días).',
  'dsm:catalog/validation': 'Falta elegir el archivo a importar.',
};

/** Copy por fila rechazada. Diez códigos, el catálogo cerrado del contrato. */
const COPY_FILA: Record<string, string> = {
  missing_required: 'Falta un dato obligatorio',
  invalid_sku: 'El SKU no es válido',
  invalid_text: 'El texto no es válido (muy largo o con caracteres raros)',
  invalid_price: 'El precio no es válido',
  invalid_stock: 'El stock no es válido',
  invalid_category: 'La categoría no es válida',
  invalid_image_url: 'La URL de la imagen no es válida',
  duplicate_sku_in_file: 'El SKU está repetido en el archivo',
  slug_conflict: 'No se pudo generar una URL única',
  write_failed: 'No se pudo guardar esta fila',
};

/** Fallo **global** del trabajo (`error_code` del `GET`), distinto de los de fila. */
const COPY_FALLO_GLOBAL: Record<string, string> = {
  interrupted:
    'La importación se interrumpió porque el servidor se reinició. Volvé a subir el mismo archivo: la reconciliación por SKU lo hace seguro.',
  'missing-columns': 'Al archivo le faltaban columnas obligatorias.',
  'row-limit-exceeded': 'El archivo superaba el máximo de filas.',
  'unsupported-format': 'El formato del archivo no está soportado.',
  'invalid-encoding': 'El archivo no estaba en UTF-8.',
  internal: 'La importación falló por un problema del servidor.',
};

/**
 * Mensaje para un rechazo del `POST`.
 *
 * El `detail` del servidor es el **fallback**, no el descarte: si aparece un
 * `type` que este panel no conoce, el dueño ve la explicación del backend en vez
 * de un hueco. Para `missing-columns` se **enumeran** las columnas que el servidor
 * mandó en `errors[]` — son los nombres del archivo (`precio`), que es lo que el
 * dueño puede arreglar.
 */
export function copyDeRechazo(error: AppError): string {
  if (error.kind === 'rateLimited') {
    const segundos = error.retryAfterSeconds;
    const espera = segundos
      ? ` Volvé a intentar en ${formatearEspera(segundos)}.`
      : ' Volvé a intentar más tarde.';
    return `Alcanzaste el límite de 3 importaciones por hora.${espera}`;
  }

  // El `AppError` de 404 **no** lleva `problemType` (la unión sólo lo propaga en
  // `validation` y `conflict`), así que en esta pantalla un 404 se resuelve por
  // `kind`: acá siempre significa «ese trabajo de import no existe».
  if (error.kind === 'notFound') {
    return COPY_ARCHIVO['dsm:import/not-found'];
  }

  const tipo = 'problemType' in error ? error.problemType : undefined;
  const base = (tipo && COPY_ARCHIVO[tipo]) || error.message;

  if (tipo === 'dsm:import/missing-columns' && error.kind === 'validation') {
    const columnas = error.fieldErrors.map((f) => f.field).filter(Boolean);
    if (columnas.length > 0) {
      return `${base} Faltan: ${columnas.join(', ')}.`;
    }
  }

  return base;
}

/** «el catálogo no se tocó» — la mitad de AC-6 que tranquiliza al dueño. */
export const SIN_IMPACTO =
  'No se importó ni se modificó ningún producto: el catálogo quedó como estaba.';

/** Copy de un `error_code` de fila, con el motivo del servidor como fallback. */
export function copyDeFila(errorCode: string, errorMessage: string): string {
  return COPY_FILA[errorCode] ?? errorMessage;
}

/** Copy del fallo global de un trabajo `failed`. */
export function copyDeFalloGlobal(
  errorCode: string | null,
  errorMessage: string | null,
): string {
  if (!errorCode) {
    return errorMessage ?? 'La importación falló.';
  }
  return COPY_FALLO_GLOBAL[errorCode] ?? errorMessage ?? 'La importación falló.';
}

/** «45 segundos» / «12 minutos» — un número crudo en segundos no le dice nada a nadie. */
function formatearEspera(segundos: number): string {
  if (segundos < 60) return `${segundos} segundos`;
  const minutos = Math.ceil(segundos / 60);
  return minutos === 1 ? '1 minuto' : `${minutos} minutos`;
}
