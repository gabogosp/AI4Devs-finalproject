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
