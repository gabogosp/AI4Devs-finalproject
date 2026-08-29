import { describe, expect, it } from 'vitest';
import {
  LEGAL_DOCUMENTS,
  LEGAL_TERMS_VERSION,
  legalDocumentSchema,
  type LegalDocumentContent,
} from './content';

const documentos = Object.values(LEGAL_DOCUMENTS);

/** Copia profunda para poder romper un documento sin ensuciar el original. */
const copia = (doc: LegalDocumentContent): LegalDocumentContent =>
  JSON.parse(JSON.stringify(doc)) as LegalDocumentContent;

describe('contenido legal (AC-5 — Ley 25.326)', () => {
  it.each(documentos.map((d) => [d.slug, d] as const))(
    '%s cumple la forma exigida',
    (_slug, doc) => {
      expect(legalDocumentSchema.safeParse(doc).success).toBe(true);
    },
  );

  // El AC-5 se **ejercita**, no se declara: se rompe el documento a propósito y
  // se exige que el schema lo rechace. Un test que sólo parsea el documento
  // bueno pasaría igual si el schema no validara nada.
  it.each(['controller', 'purpose', 'rights', 'contact'] as const)(
    'un documento SIN el bloque "%s" es rechazado',
    (bloque) => {
      const roto = copia(LEGAL_DOCUMENTS.privacidad);
      delete (roto.required as Record<string, unknown>)[bloque];

      expect(legalDocumentSchema.safeParse(roto).success).toBe(false);
    },
  );

  it('un bloque obligatorio con un párrafo vacío es rechazado', () => {
    const roto = copia(LEGAL_DOCUMENTS.privacidad);
    roto.required.rights.paragraphs = [''];

    // Un bloque presente pero vacío cumple "existe" y no cumple "informa": es
    // exactamente la forma en que un documento legal se vuelve decorativo.
    expect(legalDocumentSchema.safeParse(roto).success).toBe(false);
  });

  it('un bloque obligatorio sin ningún párrafo es rechazado', () => {
    const roto = copia(LEGAL_DOCUMENTS.terminos);
    roto.required.contact.paragraphs = [];

    expect(legalDocumentSchema.safeParse(roto).success).toBe(false);
  });
});

describe('versionado (AC-8)', () => {
  it.each(documentos.map((d) => [d.slug, d] as const))(
    '%s tiene version y effective_date ISO y coincidentes',
    (_slug, doc) => {
      expect(doc.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.effective_date).toBe(doc.version);
    },
  );

  it('LEGAL_TERMS_VERSION es la versión del documento de términos', () => {
    // Es la constante que el checkout de US-008 va a registrar en la orden. Si
    // divergiera de la versión publicada, la orden diría haber aceptado un
    // texto distinto del que el cliente leyó.
    expect(LEGAL_DOCUMENTS.terminos.version).toBe(LEGAL_TERMS_VERSION);
  });
});

describe('el contenido es texto, no marcado', () => {
  it.each(documentos.map((d) => [d.slug, d] as const))(
    '%s no contiene "<" en ningún párrafo',
    (_slug, doc) => {
      const parrafos = [
        ...Object.values(doc.required).flatMap((s) => s.paragraphs),
        ...doc.extra.flatMap((s) => s.paragraphs),
      ];

      // Si alguien metiera HTML, el render lo escaparía y el texto legal
      // saldría roto en pantalla — con etiquetas visibles para el lector.
      for (const p of parrafos) expect(p).not.toContain('<');
    },
  );
});

describe('el texto provisional se declara como tal', () => {
  it('conserva marcadores [PENDIENTE: …] visibles en la página', () => {
    const todos = documentos
      .flatMap((d) => [
        ...Object.values(d.required).flatMap((s) => s.paragraphs),
        ...d.extra.flatMap((s) => s.paragraphs),
      ])
      .join('\n');

    // No hay gate automático (decisión del PO, OQ-FE-17 (a)): la protección es
    // que el hueco se vea en la propia página, no sólo en el código.
    expect(todos).toContain('[PENDIENTE:');
  });
});
