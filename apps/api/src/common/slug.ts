/**
 * Deriva un slug kebab-normalizado (sin acentos) de un nombre. El slug NO se
 * acepta del cliente (AC-1): siempre se deriva del `name` en el service.
 * "Refrigeración" → "refrigeracion".
 */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Política de desambiguación del slug: si la base está libre la devuelve tal
 * cual; si no, agrega el primer sufijo ordinal disponible (`-2`, `-3`, …).
 *
 * Extraída de `ProductsService.deriveUniqueSlug` (US-003) para que el alta de a
 * uno y el asignador por lote del import (US-006, T2.2) compartan **una** regla:
 * si cada camino inventara su propia forma de desambiguar, dos productos con el
 * mismo nombre recibirían URLs distintas según por dónde entraron.
 *
 * Pura a propósito: sin I/O y sin tipos de framework. Quién averigua los slugs
 * ocupados —una query por producto o una por lote— es decisión del llamador.
 */
export function resolveSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let ordinal = 2;
  while (taken.has(`${base}-${ordinal}`)) ordinal += 1;
  return `${base}-${ordinal}`;
}
