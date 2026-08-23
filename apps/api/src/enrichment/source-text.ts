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
 * Compone el texto que se le manda al embedder (y del que se deriva el hash).
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
 * Hash del texto fuente. Estable entre corridas y entre máquinas (SHA-256 del texto ya
 * normalizado), así que comparar hashes es comparar «¿cambió lo que importa?».
 */
export function hashSourceText(input: SourceTextInput): string {
  return createHash('sha256').update(buildSourceText(input), 'utf8').digest('hex');
}
