/**
 * Normalización de la consulta (US-004).
 *
 * Función **pura** y en su propio archivo porque decide dos cosas a la vez: qué consultas
 * comparten entrada de caché —y por lo tanto cuándo se gasta una llamada paga— y qué texto
 * se le manda al proveedor.
 *
 * Lo que NO hace, a propósito: no quita acentos ni pasa a ASCII. «mecha widia» y «mechá widiá»
 * son consultas distintas para un embedder que entiende español, y colapsarlas nos haría
 * devolver el vector equivocado para ahorrar una llamada. El caché tiene que agrupar lo que es
 * *el mismo pedido escrito distinto*, no lo que se parece.
 */
export function normalizeQuery(consulta: string): string {
  return (
    consulta
      // Espacios de cualquier tipo (tabs, saltos, dobles) colapsados a uno: «taco  fischer» y
      // «taco fischer» son el mismo pedido y no tienen por qué costar dos llamadas.
      .replace(/\s+/g, ' ')
      .trim()
      // Minúsculas: quien escribe «TACO FISCHER» en el buscador pide lo mismo que quien
      // escribe «taco fischer».
      .toLowerCase()
  );
}

/**
 * Longitud **útil** de la consulta: la del texto normalizado, no la del crudo (AC-5).
 *
 * La distinción importa porque es la que decide si se gasta una llamada paga. `"   a   "` tiene
 * 7 caracteres y **una** letra útil: cobrarle un embedding a eso sería pagar por un espacio en
 * blanco. Al medir sobre el normalizado, el rechazo por consulta demasiado corta no se puede
 * evadir escribiendo espacios.
 */
export function usefulLength(consulta: string): number {
  return normalizeQuery(consulta).length;
}
