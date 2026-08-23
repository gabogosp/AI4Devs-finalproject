/**
 * **Fuente única** de las rutas legales del sitio.
 *
 * `as const` para que sean tipos literales: un `href` mal escrito no compila.
 * Tres consumidores las importan —el footer, el sitemap y el checkout de
 * US-008— y ninguno debe escribir el literal, porque el día que la ruta cambie
 * habría que acordarse de los tres. Hay un guard en `routes.test.ts` que falla
 * si el literal aparece en cualquier archivo que no sea éste.
 */
export const LEGAL_ROUTES = {
  privacidad: '/legales/privacidad',
  terminos: '/legales/terminos',
} as const;

/**
 * Copy del consentimiento (design-system §10.2) **con sus destinos reales**.
 *
 * El copy del design-system trae dos `(#)` porque las páginas no existían. Se
 * materializa acá, con los href de verdad, para que el checkout de US-008 lo
 * consuma en vez de reconstruirlo — mismo criterio que US-018 con el enlace de
 * WhatsApp: la fuente única se crea **antes** de tener dos consumidores, no
 * después de que diverjan.
 */
export const CONSENT_COPY = {
  lead: 'Al comprar aceptás nuestra',
  links: [
    { href: LEGAL_ROUTES.privacidad, label: 'política de privacidad' },
    { href: LEGAL_ROUTES.terminos, label: 'términos' },
  ],
  trailing: 'Usamos tus datos solo para gestionar tu pedido (Ley 25.326).',
} as const;
