import { csvCell } from './csv-cell';

/**
 * Mismos casos que ya cubría `celdaCsv` en
 * `imports/e2e-imports-report.spec.ts` (bloque "celdaCsv (neutralización +
 * RFC 4180)") — ahora contra `csvCell` directo, tras la extracción de
 * `design.md §D3`.
 */
describe('csvCell (neutralización + RFC 4180)', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ["=cmd|'/c calc'!A1", "'=cmd|'/c calc'!A1"],
    ['\tvalor', "'\tvalor"],
  ])('neutraliza %s', (entrada, esperado) => {
    expect(csvCell(entrada)).toBe(esperado);
  });

  it.each([
    ['con,coma', '"con,coma"'],
    ['con"comilla', '"con""comilla"'],
    ['con\nsalto', '"con\nsalto"'],
    ['normal', 'normal'],
    ['', ''],
  ])('escapa %s según RFC 4180', (entrada, esperado) => {
    expect(csvCell(entrada)).toBe(esperado);
  });

  it('null y undefined son celda vacía, no la cadena "null"', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('un texto que sólo contiene un guión adentro no se toca', () => {
    // La neutralización mira el PRIMER caracter: `REF-1` no es una fórmula.
    expect(csvCell('REF-1')).toBe('REF-1');
  });
});
