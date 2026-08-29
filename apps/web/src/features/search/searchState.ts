import type { SearchResponse } from './searchService';

/**
 * La derivación de `design.md` §D5: el contrato trae tres campos ortogonales
 * (`confidence`, `degraded`, `fallback`) y la pantalla tiene que contar **un**
 * relato.
 *
 * Es una función pura y vive fuera del componente a propósito: la regla de qué
 * se le dice al cliente es la parte que más importa acertar, y así se prueba sin
 * montar nada ni buscar texto en un DOM.
 *
 * | Estado      | Condición                        |
 * |-------------|----------------------------------|
 * | `conSenal`  | `confidence: high` con resultados |
 * | `conReserva`| `confidence: low` y hay resultados |
 * | `sinSenal`  | `results` vacío                   |
 *
 * `degraded` **no** entra en esta unión: es ortogonal (AC-4). Una respuesta
 * degradada puede traer resultados perfectamente útiles, y tratarla como un
 * cuarto estado excluyente obligaría a elegir entre avisar que fue el plan B o
 * avisar que no estamos seguros, cuando las dos cosas pueden ser ciertas a la
 * vez. Por eso el banner de degradado se superpone a cualquiera de los tres.
 */
export type SearchState = 'conSenal' | 'conReserva' | 'sinSenal';

export function derivarEstado(res: SearchResponse): SearchState {
  // El vacío gana sobre todo lo demás: sin resultados no hay nada que presentar
  // con reserva ni con confianza, cualquiera sea el `confidence` que llegue.
  if (res.results.length === 0) return 'sinSenal';
  return res.confidence === 'high' ? 'conSenal' : 'conReserva';
}
