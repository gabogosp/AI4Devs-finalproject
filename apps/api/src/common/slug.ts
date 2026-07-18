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
