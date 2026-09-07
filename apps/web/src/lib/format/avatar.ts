/**
 * Placeholder determinístico del avatar (US-024, C2a) — puro, sin React,
 * mismo criterio que `currency.ts`/`datetime.ts`. Sin librería nueva.
 */

/** Primera + última inicial (mayúsculas). Un nombre de una palabra da 1 letra. */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + second).toUpperCase();
}

/**
 * Hash simple → hue 0-359. Mismo id => mismo color, siempre, sin persistir nada.
 *
 * `lightness: 25%` (no el 55% original) — verificado con la fórmula de
 * contraste de WCAG: a 55%, el peor caso (hue amarillo ~60°) da 1.54:1
 * contra texto blanco, muy por debajo del 3:1 mínimo de AA para texto
 * grande — y el tamaño `sm`/`md` del avatar ni siquiera califica como
 * "texto grande" (exige 4.5:1). A 25%, el peor caso en los 360 hues da
 * 5.76:1, que cubre ambos umbrales sin importar el tamaño.
 */
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 65% 25%)`;
}
