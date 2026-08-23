import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LEGAL_DOCUMENTS } from './content';
import { LEGAL_ROUTES } from './routes';

import PrivacidadPage, { metadata as metaPrivacidad } from '@/../app/(storefront)/legales/privacidad/page';
import TerminosPage, { metadata as metaTerminos } from '@/../app/(storefront)/legales/terminos/page';

const casos = [
  ['privacidad', PrivacidadPage, metaPrivacidad, LEGAL_DOCUMENTS.privacidad, LEGAL_ROUTES.privacidad],
  ['terminos', TerminosPage, metaTerminos, LEGAL_DOCUMENTS.terminos, LEGAL_ROUTES.terminos],
] as const;

describe('páginas legales (AC-1, AC-2)', () => {
  it.each(casos)('%s renderiza SU documento', (_slug, Page, _meta, doc) => {
    render(<Page />);

    // Si alguien cruzara los documentos entre las dos páginas, este assert lo
    // detecta: cada ruta tiene que servir el suyo.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(doc.title);
  });

  it.each(casos)('%s declara la canonical de SU ruta', (_slug, _Page, meta, _doc, ruta) => {
    expect(String(meta.alternates?.canonical).endsWith(ruta)).toBe(true);
  });
});
