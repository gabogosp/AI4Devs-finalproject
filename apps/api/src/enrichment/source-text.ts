import { createHash } from 'node:crypto';

/**
 * Texto fuente del enriquecimiento y su hash (US-005 T3.1) — funciones **puras**: sin Nest,
 * sin Prisma, sin reloj. Es donde vive el control de costo de AC-6, y por eso conviene que
 * sea el archivo más aburrido y más testeable del módulo.
 *
 * La decisión de qué entra al texto es D3 del `design.md`: **nombre + rubro + texto**. El
 * rubro entra porque sin él «Mecha widia 8» es casi ruido para el embedder; con «Mechas y
 * brocas» al lado, el vector cae cerca de las consultas que un cliente realmente escribe.
 */

/**
 * Insumos del texto fuente.
 *
 * **No incluye `price_ars_cents` ni `stock` a propósito.** El hash decide si se gasta una
 * llamada paga al proveedor: si el precio entrara, cada cambio de lista de precios
 * re-enriquecería el catálogo completo. Que no estén en la firma lo hace imposible **por
 * construcción**, no por convención — nadie puede pasarlos por accidente.
 */
export interface SourceTextInput {
  name: string;
  categoryName: string;
  /** Texto escrito por el dueño. Máxima prioridad: la IA no lo pisa (AC-7). */
  curated: string | null;
  /** Texto que escribió la IA en una corrida anterior. */
  enriched: string | null;
  /** `description_raw`: lo que vino del catálogo o del import. */
  raw: string | null;
}

/** Colapsa espacios y saltos (incluido `\r\n`) para que un cambio cosmético no cueste plata. */
function normalizar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/**
 * Compone el texto que se le manda al embedder.
 *
 * Prioridad del texto: **curado ∥ enriquecido ∥ base**. El curado gana siempre porque es la
 * voz del dueño; el enriquecido previo gana sobre el base porque ya es mejor insumo que la
 * descripción pobre original.
 */
export function buildSourceText(input: SourceTextInput): string {
  const elegido = [input.curated, input.enriched, input.raw]
    .map((t) => (t ? normalizar(t) : ''))
    .find((t) => t.length > 0);

  // Un producto sin ninguna descripción es el caso REAL del catálogo de DSM: el nombre y
  // el rubro son el único insumo, y alcanzan para un embedding útil.
  return normalizar(
    [normalizar(input.name), normalizar(input.categoryName), elegido ?? '']
      .filter((p) => p.length > 0)
      .join('. '),
  );
}

/**
 * Clave de **cambio**: lo que el dueño controla, y nada de lo que la IA produjo.
 *
 * Es deliberadamente distinta del texto que se embeddea, y la diferencia es un bug que este
 * archivo ya tuvo: si el hash se calcula sobre `buildSourceText`, en un producto ya enriquecido
 * el texto elegido es el que escribió la IA, así que **corregir la `description_raw` no cambia
 * el hash** y la corrida siguiente lo saltea como «sin cambios». El dueño arregla una
 * descripción mal cargada, la búsqueda sigue encontrando el producto por el texto viejo, y no
 * hay forma de notarlo desde afuera.
 *
 * Derivar la detección de cambios del **output** en vez del **input** es el error de fondo. Acá
 * entran sólo entradas: nombre, rubro y —según quién manda— el texto curado o el base.
 */
export function buildChangeKey(input: SourceTextInput): string {
  // Curado ⇒ manda el texto del dueño y el `raw` deja de ser relevante: el texto que se
  // embeddea es el curado, así que un cambio del `raw` produciría el MISMO vector y una
  // llamada paga al proveedor por nada.
  const base = input.curated ?? input.raw;
  return normalizar(
    [normalizar(input.name), normalizar(input.categoryName), base ? normalizar(base) : '']
      .filter((p) => p.length > 0)
      .join('. '),
  );
}

/**
 * Hash de la clave de cambio. Estable entre corridas y entre máquinas (SHA-256 del texto ya
 * normalizado), así que comparar hashes es comparar «¿cambió lo que el dueño controla?».
 */
export function hashSourceText(input: SourceTextInput): string {
  return createHash('sha256').update(buildChangeKey(input), 'utf8').digest('hex');
}
