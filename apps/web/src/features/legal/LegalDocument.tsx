import type { LegalDocumentContent } from './content';

/**
 * Presentación de un documento legal.
 *
 * Server Component sin `'use client'` (`frontend-next-standards.md` §2): una
 * página de texto no necesita un solo byte de JavaScript en el cliente.
 *
 * Los párrafos se renderizan **como texto**: el contenido es dato tipado, no
 * marcado, así que no hay `dangerouslySetInnerHTML` ni forma de inyectar HTML
 * desde el contenido.
 */
export function LegalDocument({ doc }: { doc: LegalDocumentContent }) {
  // Obligatorias primero y en el orden de la Ley 25.326 —quién trata, para qué,
  // qué derechos tenés, cómo ejercerlos—; las extras después.
  const sections = [
    doc.required.controller,
    doc.required.purpose,
    doc.required.rights,
    doc.required.contact,
    ...doc.extra,
  ];

  return (
    <article className="mx-auto max-w-prose px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground">{doc.title}</h1>

      {/* Mitad visible de AC-8: la versión que la orden registra, legible por
          humanos y por máquinas (`<time datetime>`). */}
      <p className="mt-2 text-sm text-muted">
        Versión {doc.version} · vigente desde{' '}
        <time dateTime={doc.effective_date}>{doc.effective_date}</time>
      </p>

      {sections.map((section) => (
        <section key={section.heading} className="mt-6">
          <h2 className="text-lg font-semibold text-foreground">{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-2 text-sm leading-relaxed text-foreground">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
