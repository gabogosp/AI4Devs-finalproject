/**
 * Traduce los `issues` de `CreateGuestCheckoutBody.safeParse` (Zod, generado) a
 * copy en español (`design-system.md` §10.2), **sin redeclarar** ninguna
 * constraint (`frontend-standards.md` §3.2 — prohibido un mirror hand-written
 * del contrato). El schema que valida sigue siendo el generado; esto sólo
 * traduce el mensaje por `path`.
 */
const MESSAGES: Record<string, string> = {
  'buyer.name': 'Ingresá tu nombre (al menos 2 caracteres).',
  'buyer.email': 'Ingresá un email válido.',
  'buyer.phone': 'Ingresá un teléfono válido (ej. +54 9 11 5555 5555).',
  consent: 'Tenés que aceptar los términos para continuar.',
};

export function friendlyMessage(path: (string | number)[]): string {
  return MESSAGES[path.join('.')] ?? 'Revisá este campo.';
}
