/**
 * La regla de AC-5 del lado del cliente (design.md D7).
 *
 * Una búsqueda cuesta plata: embebe la consulta contra un proveedor externo con
 * cuota. Mandar `'a'` gasta esa cuota para devolver ruido. El guard corta antes,
 * en los dos lugares donde se puede entrar a la búsqueda — el formulario y la
 * URL escrita a mano— para que AC-5 no valga sólo para quien usa el `SearchBar`.
 *
 * Lo que el guard **no** es: una garantía de que el 422 no llegue. El servidor
 * tiene su propio `SEARCH_MIN_LENGTH` y puede diferir del de acá; por eso el
 * copy del 422 existe igual (`searchErrorCopy`). Asumir que una validación del
 * cliente vuelve inalcanzable un error del servidor es cómo se termina
 * mostrando un `detail` crudo el día que alguien cambia una variable de entorno.
 */

/**
 * Mínimo de caracteres **útiles** (los del texto normalizado). Dos, no tres:
 * «M8», «1/2» y «T5» son consultas legítimas en una ferretería.
 */
export const MIN_CARACTERES_UTILES = 2;

/**
 * Normaliza igual que el servidor en lo que hace a la **forma**: recorta los
 * extremos y colapsa los espacios internos, de modo que llenar de espacios no
 * evada el mínimo.
 *
 * Lo que **no** hace es bajar a minúsculas, y la diferencia importa. El servidor
 * sí lo hace, pero para su clave de caché de vectores: le sirve que «Taco» y
 * «taco» sean la misma consulta. Acá el texto normalizado es el que viaja y el
 * que se le muestra de vuelta al cliente en el eco («Resultados para: …»), y
 * devolverle su consulta en minúsculas es corregirle cómo escribe.
 */
export function normalizar(q: string): string {
  return q.trim().replace(/\s+/g, ' ');
}

/**
 * `true` cuando la consulta merece un request. Se mide sobre el texto
 * normalizado, así que `'  a  '` cuenta como un solo carácter útil y no pasa.
 */
export function esConsultaUtil(q: string | null | undefined): boolean {
  if (!q) return false;
  return normalizar(q).length >= MIN_CARACTERES_UTILES;
}
