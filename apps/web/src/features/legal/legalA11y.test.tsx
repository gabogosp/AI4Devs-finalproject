import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { LegalDocument } from './LegalDocument';
import { LEGAL_DOCUMENTS } from './content';

expect.extend(toHaveNoViolations);

/**
 * WCAG 2.1 AA sobre las dos páginas legales (US-017 T3.2, `design-system.md` §11,
 * `qa-frontend-standards.md` §23.6).
 *
 * **Límite conocido, heredado de US-003 y US-018**: jsdom **no calcula contraste**, así que
 * un fallo de color no aparece acá — el del `text-muted` lo encontró axe en un browser real,
 * no un test como éste. Lo que sí cubre este archivo es lo que jsdom sí puede ver: nombres
 * accesibles, roles, landmarks y —lo que axe tampoco marca siempre— la **jerarquía de
 * headings**, que en un documento legal largo es lo que decide si se puede navegar por
 * estructura o hay que leerlo todo de corrido.
 */
describe.each(Object.entries(LEGAL_DOCUMENTS))(
  'accesibilidad de la página legal «%s»',
  (_slug, doc) => {
    it('no tiene violaciones de axe', async () => {
      const { container } = render(<LegalDocument doc={doc} />);
      expect(await axe(container)).toHaveNoViolations();
    });

    it('tiene exactamente un h1, y es el título del documento', () => {
      render(<LegalDocument doc={doc} />);

      const h1 = screen.getAllByRole('heading', { level: 1 });
      expect(h1).toHaveLength(1);
      expect(h1[0]).toHaveTextContent(doc.title);
    });

    it('los headings no saltan niveles', () => {
      render(<LegalDocument doc={doc} />);

      const niveles = screen
        .getAllByRole('heading')
        .map((h) => Number(h.tagName.slice(1)));

      // Un salto de h1 a h3 rompe la navegación por estructura de un lector de
      // pantalla: la persona no sabe si se perdió una sección.
      niveles.slice(1).forEach((nivel, i) => {
        expect(nivel - niveles[i]).toBeLessThanOrEqual(1);
      });
      expect(niveles[0]).toBe(1);
    });

    it('cada sección del contenido tiene su heading', () => {
      render(<LegalDocument doc={doc} />);

      // Si una sección se renderizara sin heading, el documento seguiría
      // leyéndose pero dejaría de ser navegable — y es justo lo que hace usable
      // un texto legal largo. Se recorren las CUATRO obligatorias de la Ley
      // 25.326 más las extra: `required` es un objeto de claves fijas
      // precisamente para que el compilador exija cada una (content.ts §required).
      const secciones = [...Object.values(doc.required), ...doc.extra];
      expect(secciones.length).toBeGreaterThanOrEqual(4);
      secciones.forEach((s) => {
        expect(
          screen.getByRole('heading', { name: s.heading }),
        ).toBeInTheDocument();
      });
    });

    it('declara la versión del documento de forma legible', () => {
      render(<LegalDocument doc={doc} />);
      // AC-8: la versión no es metadata oculta, es parte de lo que la persona
      // acepta. Tiene que estar en el texto, no sólo en un atributo.
      // `getAllByText`: la versión aparece más de una vez a propósito (encabezado
      // y pie del documento), así que lo que se asserta es que esté presente y
      // legible, no que sea única.
      expect(screen.getAllByText(new RegExp(doc.version)).length).toBeGreaterThan(0);
    });
  },
);
