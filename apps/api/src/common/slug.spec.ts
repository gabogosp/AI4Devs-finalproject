import { resolveSlug, slugify } from './slug';

describe('slugify', () => {
  it('normaliza acentos, mayúsculas y separadores', () => {
    expect(slugify('Refrigeración')).toBe('refrigeracion');
    expect(slugify('  Heladera   Exhibidora  ')).toBe('heladera-exhibidora');
    expect(slugify('Taco Fischer SX 8mm (x50)')).toBe('taco-fischer-sx-8mm-x50');
  });

  it('devuelve cadena vacía cuando no hay nada alfanumérico', () => {
    // El llamador usa esto para decidir el fallback al sku.
    expect(slugify('###')).toBe('');
  });
});

describe('resolveSlug — política de desambiguación compartida', () => {
  it('devuelve la base cuando está libre', () => {
    expect(resolveSlug('heladera', new Set())).toBe('heladera');
  });

  it('agrega -2 cuando la base está ocupada', () => {
    expect(resolveSlug('heladera', new Set(['heladera']))).toBe('heladera-2');
  });

  it('salta al -3 cuando el -2 también está ocupado', () => {
    expect(resolveSlug('heladera', new Set(['heladera', 'heladera-2']))).toBe(
      'heladera-3',
    );
  });

  it('llena el hueco: con base y -3 ocupados, devuelve -2', () => {
    // Importa que no "siga contando" desde el máximo: el objetivo es un slug
    // libre, no una secuencia monótona.
    expect(resolveSlug('heladera', new Set(['heladera', 'heladera-3']))).toBe(
      'heladera-2',
    );
  });

  it('no confunde una base con el prefijo de otra', () => {
    // `heladera-exhibidora` empieza con `heladera` pero no ocupa su slug: el
    // llamador trae los slugs por prefijo y la política no debe engañarse.
    expect(resolveSlug('heladera', new Set(['heladera-exhibidora']))).toBe(
      'heladera',
    );
  });

  it('es pura: no muta el set que recibe', () => {
    const taken = new Set(['heladera']);
    resolveSlug('heladera', taken);
    expect([...taken]).toEqual(['heladera']);
  });
});
