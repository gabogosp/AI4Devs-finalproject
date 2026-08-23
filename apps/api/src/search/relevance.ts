/**
 * Las decisiones de relevancia de la búsqueda, como funciones **puras** (US-004 T2.1).
 *
 * Sin Nest, sin Postgres y sin Gemini: acá vive el umbral que separa «encontré» de «creo que
 * encontré», y por eso conviene que sea el archivo más aburrido y más testeable del módulo. Un
 * umbral escondido dentro de un service que necesita una base y una API key para ejercerse es
 * un umbral que nadie recalibra.
 */

/** Confianza de la respuesta (D5). Define qué ve el cliente, no cuánto acertamos. */
export type Confidence = 'high' | 'low' | 'none';

/**
 * Lo mínimo que las dos vías de búsqueda —vectorial y full-text— devuelven igual.
 *
 * Que compartan forma es deliberado: el servicio tiene **un** camino de mapeo a DTO, así que
 * la degradación no puede introducir una diferencia de forma en la respuesta. Si el full-text
 * devolviera otra cosa, el cliente tendría que distinguir dos contratos.
 */
export interface ScoredProduct {
  slug: string;
  name: string;
  price_ars_cents: number;
  stock: number;
  image_url: string | null;
  category_name: string | null;
  /** `0..1`. En la vía vectorial es `1 - distancia_cosine`; en la léxica, `ts_rank` normalizado. */
  score: number;
}

/**
 * `high` cuando el mejor resultado supera el umbral; `low` cuando hay resultados pero ninguno
 * convence; `none` cuando no hay nada.
 *
 * La distinción entre `low` y `none` es la que le permite al frontend ser honesto: en `low`
 * muestra los resultados **avisando** que no está seguro, en vez de presentarlos con la misma
 * seguridad que un match exacto. Colapsar los dos casos obligaría a elegir entre mentir o
 * esconder resultados que quizás sirven.
 */
export function classify(results: ScoredProduct[], minScore: number): Confidence {
  if (results.length === 0) return 'none';
  const mejor = Math.max(...results.map((r) => r.score));
  return mejor >= minScore ? 'high' : 'low';
}

/**
 * Combina el ranking vectorial con el léxico según `weight` (0 = vector puro, 1 = léxico puro).
 *
 * Los dos extremos son **exactos** a propósito: con `weight = 0` el orden devuelto es el
 * vectorial sin reordenar nada, y con `1` el léxico. Es lo que permite que
 * `SEARCH_LEXICAL_WEIGHT` sea una perilla operable sin desplegar código —arranca en 0 y se
 * sube si la batería de relevancia no llega al 70 %— con la garantía de que en 0 no cambia
 * absolutamente nada respecto de no tener blend.
 */
export function blend(
  vector: ScoredProduct[],
  lexical: ScoredProduct[],
  weight: number,
): ScoredProduct[] {
  if (weight <= 0) return [...vector];
  if (weight >= 1) return [...lexical];

  const porSlug = new Map<string, { p: ScoredProduct; v: number; l: number }>();
  for (const p of vector) porSlug.set(p.slug, { p, v: p.score, l: 0 });
  for (const p of lexical) {
    const previo = porSlug.get(p.slug);
    if (previo) previo.l = p.score;
    // Un producto que sólo aparece por la vía léxica entra con score vectorial 0: es el
    // rescate del caso que el vector hace peor (un SKU, un nombre técnico exacto).
    else porSlug.set(p.slug, { p, v: 0, l: p.score });
  }

  return [...porSlug.values()]
    .map(({ p, v, l }) => ({ ...p, score: (1 - weight) * v + weight * l }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Categorías para ofrecer una salida cuando la búsqueda no convence (AC-3).
 *
 * **Nunca devuelve lista vacía**: si no hay candidatos, cae a las categorías raíz. Un «0
 * resultados» desnudo es un callejón sin salida, y el cliente que lo ve no vuelve a buscar —
 * se va. Por eso la lista vacía no es un caso válido de esta función, es un bug.
 */
export function suggestedCategories(
  candidates: ScoredProduct[],
  rootCategories: string[],
  max = 3,
): string[] {
  const deCandidatos = distintas(candidates).slice(0, max);
  if (deCandidatos.length > 0) return deCandidatos;
  return rootCategories.slice(0, max);
}

/**
 * «Buscamos en: Fijaciones, Mechas y brocas» — la interpretación **visible** de AC-8.
 *
 * Se arma con las categorías del top-N y **no cuesta una llamada al LLM** (OQ-BE-3). Eso tiene
 * dos consecuencias que valen más que el ahorro: con el free tier, no gastar una segunda
 * llamada en el camino interactivo es la diferencia entre funcionar y no funcionar; y como el
 * texto del usuario **nunca llega a un modelo generativo**, AC-8 (anti prompt-injection) pasa
 * a ser **estructural** en vez de una promesa. No se puede inyectar un prompt en un modelo al
 * que no se le habla.
 *
 * Y es honesto: dice **dónde miró**, no finge haber entendido la intención.
 */
export function interpretedAs(top: ScoredProduct[], max = 3): string | null {
  const categorias = distintas(top).slice(0, max);
  if (categorias.length === 0) return null;
  return `Buscamos en: ${categorias.join(', ')}`;
}

/** Categorías distintas, en el orden en que aparecen (el orden es el del ranking). */
function distintas(productos: ScoredProduct[]): string[] {
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const p of productos) {
    const c = p.category_name?.trim();
    if (!c || vistas.has(c)) continue;
    vistas.add(c);
    salida.push(c);
  }
  return salida;
}
