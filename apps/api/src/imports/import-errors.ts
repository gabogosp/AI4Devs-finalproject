import { DomainError, FieldError } from '../common/errors/domain-errors';

/**
 * Errores de dominio del import masivo (§6). Los mapea el `HttpProblemFilter`
 * existente al envelope RFC 7807, igual que los de catálogo y auth — por eso
 * extienden `DomainError` y no traen nada de NestJS.
 *
 * El catálogo es **cerrado**: estos son todos los `type` que la superficie de
 * import puede devolver, y el contrato OpenAPI (T8.1) los declara uno por uno.
 *
 * Regla que gobierna los mensajes de acá: **ningún `detail` nombra tablas ni
 * columnas de la base**. El dueño subió un archivo con la columna `precio`; que
 * el error le hable de `price_ars_cents` no lo ayuda a arreglar el archivo y sí
 * le regala el esquema interno a cualquiera que sondee la superficie.
 */

/**
 * 415 — el contenido del archivo no es ni un xlsx ni texto. Se decide por
 * **magic bytes**, nunca por la extensión ni por el `Content-Type` (§6.4): los
 * dos son atacante-controlados.
 */
export class UnsupportedFormatError extends DomainError {
  readonly status = 415;
  readonly type = 'dsm:import/unsupported-format';

  constructor(
    message = 'El archivo no es un CSV ni un Excel (.xlsx) válido.',
  ) {
    super(message);
  }
}

/**
 * 422 — el archivo es texto pero no está en UTF-8, así que no se puede leer sin
 * corromper los acentos.
 *
 * Se **rechaza** en vez de decodificar con reemplazos (OQ-BE-5): un catálogo
 * cargado con "Refrigeraci�n" es peor que un import que falla, porque el error
 * queda en la base y lo descubre el cliente en el storefront.
 */
export class InvalidEncodingError extends DomainError {
  readonly status = 422;
  readonly type = 'dsm:import/invalid-encoding';

  constructor(
    message = 'El archivo no está codificado en UTF-8. Guardalo como "CSV UTF-8" y volvé a subirlo.',
  ) {
    super(message);
  }
}

/**
 * 422 — faltan encabezados requeridos. Enumera **cuáles faltan** con el nombre
 * que el dueño escribe en su archivo (`precio`), no el de la base.
 */
export class MissingColumnsError extends DomainError {
  readonly status = 422;
  readonly type = 'dsm:import/missing-columns';

  constructor(missing: string[]) {
    super(
      `El archivo no tiene las columnas requeridas: ${missing.join(', ')}.`,
      missing.map<FieldError>((field) => ({
        field,
        message: 'columna requerida ausente en el encabezado',
      })),
    );
  }
}

/**
 * 422 — el archivo tiene más filas que el tope vigente. El mensaje **dice el
 * número**: un dueño que no sabe el tope no puede decidir si partir el archivo.
 */
export class RowLimitExceededError extends DomainError {
  readonly status = 422;
  readonly type = 'dsm:import/row-limit-exceeded';

  constructor(maxRows: number) {
    super(
      `El archivo supera el máximo de ${maxRows} filas. Partilo en archivos más chicos y subilos de a uno.`,
    );
  }
}
