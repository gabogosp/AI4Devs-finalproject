import type { Metadata } from 'next';

/**
 * Metadatos de `/checkout`.
 *
 * `index: false`: mismo motivo que `/carrito` (`cartMetadata.ts`) — un
 * formulario con PII del comprador no es contenido público (`design.md` D1).
 *
 * Vive en un módulo aparte del `page.tsx` para poder testearlo sin renderizar
 * la página, igual que `cartMetadata`/`legalMetadata`.
 */
export const checkoutMetadata: Metadata = {
  title: 'Checkout — DSM Refrigeración y Ferretería',
  description: 'Confirmá tus datos y el retiro en el local para completar tu pedido.',
  robots: { index: false, follow: true },
};
