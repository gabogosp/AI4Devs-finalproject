import type { Metadata } from 'next';
import { publicEnv } from '@/lib/env';
import type { LegalDocumentContent } from './content';
import { LEGAL_ROUTES } from './routes';

const SITE_NAME = 'DSM Refrigeración y Ferretería';

/** URL pública canónica de un documento legal — absoluta, como exigen los buscadores. */
export function legalUrl(slug: LegalDocumentContent['slug']): string {
  return `${publicEnv.NEXT_PUBLIC_SITE_URL}${LEGAL_ROUTES[slug]}`;
}

/**
 * Metadata de una página legal (`frontend-next-standards.md` §6 — Metadata API,
 * nunca `<head>` manual). Función pura para poder testearla aparte.
 *
 * **No emite `robots: { index: false }`**: estas páginas son indexables a
 * propósito. El AC-1 y el AC-2 piden URL pública **e indexable**, y una política
 * de privacidad que un buscador no encuentra no cumple su función.
 */
export function legalMetadata(doc: LegalDocumentContent): Metadata {
  const url = legalUrl(doc.slug);

  return {
    title: `${doc.title} — ${SITE_NAME}`,
    description: `${doc.title} de ${SITE_NAME}. Versión ${doc.version}.`,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: SITE_NAME, title: doc.title, url },
  };
}
