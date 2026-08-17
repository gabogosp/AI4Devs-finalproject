import type { Metadata } from 'next';

/**
 * Home pública (stub). La home real del storefront —grilla de productos,
 * navegación por categoría, buscador— es `Deferred: US-002`/`US-004`.
 *
 * Existe ahora porque ADR-0010 le da la raíz al público: el 404 de la ficha y
 * el JSON-LD necesitan un "inicio" real al que enlazar.
 */
export const metadata: Metadata = {
  title: 'DSM Refrigeración y Ferretería',
  description:
    'Ferretería y refrigeración en CABA. Comprá online y retirá en el local.',
};

export default function StorefrontHome() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-8">
      <h1 className="text-3xl font-bold text-foreground">
        DSM Refrigeración y Ferretería
      </h1>
      <p className="text-muted">
        Comprá online y retirá en nuestro local de Av. Córdoba y Av. Pueyrredón.
      </p>
    </div>
  );
}
