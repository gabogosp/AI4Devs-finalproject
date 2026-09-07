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

/** Hash simple → hue 0-359. Mismo id => mismo color, siempre, sin persistir nada. */
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 65% 55%)`;
}
