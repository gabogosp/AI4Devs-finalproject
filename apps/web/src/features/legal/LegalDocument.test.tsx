import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LegalDocument } from './LegalDocument';
import { LEGAL_DOCUMENTS, type LegalDocumentContent } from './content';

const doc = LEGAL_DOCUMENTS.privacidad;

describe('LegalDocument (AC-1, AC-2)', () => {
  it('renderiza un único h1 con el título', () => {
    render(<LegalDocument doc={doc} />);

    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent(doc.title);
  });

  it('muestra la versión con <time datetime> — legible por humanos y máquinas (AC-8)', () => {
    const { container } = render(<LegalDocument doc={doc} />);

    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time!.getAttribute('dateTime') ?? time!.getAttribute('datetime')).toBe(
      doc.effective_date,
    );
    expect(screen.getByText(new RegExp(`Versión ${doc.version}`))).toBeInTheDocument();
  });

  it('hay un h2 por sección y el primero es el responsable del tratamiento', () => {
    render(<LegalDocument doc={doc} />);

    const h2 = screen.getAllByRole('heading', { level: 2 });
    expect(h2).toHaveLength(4 + doc.extra.length);
    // El orden importa: la Ley 25.326 espera saber primero QUIÉN trata los datos.
    expect(h2[0]).toHaveTextContent(doc.required.controller.heading);
  });

  it('un documento sin secciones extra renderiza igual, con los 4 obligatorios', () => {
    const soloObligatorias: LegalDocumentContent = { ...doc, extra: [] };

    render(<LegalDocument doc={soloObligatorias} />);

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
  });

  it('el contenido es TEXTO: el HTML del dato no se interpreta', () => {
    const conHtml: LegalDocumentContent = {
      ...doc,
      extra: [{ heading: 'Prueba', paragraphs: ['<b>hola</b>'] }],
    };

    const { container } = render(<LegalDocument doc={conHtml} />);

    // Aparece literal en pantalla y NO como un <b> en el DOM: es la prueba de
    // que no hay `dangerouslySetInnerHTML` en el camino.
    expect(screen.getByText('<b>hola</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('el componente no lleva "use client": cero JS de cliente en una página de texto', () => {
    const fuente = readFileSync(path.join(__dirname, 'LegalDocument.tsx'), 'utf8');

    // Se ancla a la DIRECTIVA, no a la mención: Next sólo la reconoce como
    // primera sentencia del archivo. Buscar el substring daba falso positivo
    // con el propio comentario que explica por qué no la lleva.
    const primeraSentencia = fuente.trimStart().split('\n')[0].trim();
    expect(primeraSentencia).not.toMatch(/^['"]use client['"]/);

    // Igual que arriba: se busca el USO como atributo JSX, no la mención. El
    // comentario del componente explica por qué no lo lleva, y un guard que
    // matchea su propia documentación es un rojo permanente (misma familia que
    // F57 — el escáner no debe escanearse a sí mismo).
    expect(fuente).not.toMatch(/dangerouslySetInnerHTML\s*=/);
  });
});
