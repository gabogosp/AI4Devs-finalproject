import type { Metadata } from 'next';

/**
 * Metadatos de `/carrito`.
 *
 * `index: false` es la contraparte obligada de que el carrito sea una vista de
 * cliente: no hay nada que indexar —un carrito no es contenido público— y una URL
 * personalizada en el índice de Google sería un problema, no una oportunidad.
 *
 * Vive en un módulo aparte del `page.tsx` para poder testearlo sin renderizar la
 * página, igual que `legalMetadata` (US-017).
 */
export const cartMetadata: Metadata = {
  title: 'Tu carrito — DSM Refrigeración y Ferretería',
  description: 'Revisá lo que agregaste antes de retirar en el local.',
  robots: { index: false, follow: true },
};
