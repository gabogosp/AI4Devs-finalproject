import { describe, expect, it } from 'vitest';
import { legalMetadata } from './legalMetadata';
import { LEGAL_DOCUMENTS } from './content';

const casos = [
  ['privacidad', LEGAL_DOCUMENTS.privacidad, '/legales/privacidad'],
  ['terminos', LEGAL_DOCUMENTS.terminos, '/legales/terminos'],
] as const;

describe('legalMetadata (AC-1, AC-2)', () => {
  it.each(casos)('%s: canonical absoluta y terminada en su ruta', (_slug, doc, ruta) => {
    const canonical = String(legalMetadata(doc).alternates?.canonical);

    // Absoluta: una canonical relativa la ignoran los buscadores.
    expect(canonical.startsWith('http')).toBe(true);
    expect(canonical.endsWith(ruta)).toBe(true);
    // Sin barra duplicada al concatenar origen + ruta.
    expect(canonical.replace(/^https?:\/\//, '')).not.toContain('//');
  });

  it.each(casos)('%s: el title incluye el nombre del sitio', (_slug, doc) => {
    expect(String(legalMetadata(doc).title)).toContain('DSM Refrigeración y Ferretería');
  });

  it.each(casos)('%s: la description no supera 160 caracteres', (_slug, doc) => {
    expect(String(legalMetadata(doc).description).length).toBeLessThanOrEqual(160);
  });

  it.each(casos)('%s: NO se des-indexa — son públicas a propósito (AC-1/AC-2)', (_slug, doc) => {
    // Una política de privacidad que un buscador no encuentra no cumple su
    // función; `noindex` acá sería un defecto, no una precaución.
    expect(legalMetadata(doc).robots).toBeUndefined();
  });
});
