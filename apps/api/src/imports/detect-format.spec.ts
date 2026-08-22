import ExcelJS from 'exceljs';
import { decodeCsv, detectFormat } from './detect-format';
import { InvalidEncodingError, UnsupportedFormatError } from './import-errors';

/**
 * T1.1 — el formato se decide por CONTENIDO, nunca por la extensión ni por el
 * `Content-Type` (§6.4). Los casos negativos son el corazón de este spec: un
 * ejecutable renombrado a `.csv` y un archivo en windows-1252 son las dos formas
 * reales en que llega basura a un import de ferretería (una maliciosa, la otra
 * el default de Excel en español).
 */

/** xlsx real mínimo: una hoja, una celda. Producido por la misma lib que lo lee. */
async function xlsxMinimo(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet('catalogo');
  hoja.addRow(['sku', 'nombre']);
  hoja.addRow(['REF-1', 'Heladera']);
  const escrito = await wb.xlsx.writeBuffer();
  return Buffer.from(escrito);
}

const CSV = 'sku,nombre,precio,stock,categoria\nREF-1,Heladera,1234.56,3,Refrigeración\n';

describe('detectFormat — sniffing por magic bytes', () => {
  it('un xlsx real devuelve "xlsx"', async () => {
    const buffer = await xlsxMinimo();
    // Todo xlsx es un zip: la firma local PK\x03\x04 está al principio.
    expect(buffer.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    expect(detectFormat(buffer, 'catalogo.xlsx')).toBe('xlsx');
  });

  it('un xlsx real con nombre .csv sigue siendo "xlsx" (el nombre no decide)', async () => {
    const buffer = await xlsxMinimo();
    expect(detectFormat(buffer, 'catalogo.csv')).toBe('xlsx');
  });

  it('un CSV UTF-8 devuelve "csv", con y sin BOM', () => {
    const sinBom = Buffer.from(CSV, 'utf8');
    const conBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(CSV, 'utf8'),
    ]);
    expect(detectFormat(sinBom, 'catalogo.csv')).toBe('csv');
    expect(detectFormat(conBom, 'catalogo.csv')).toBe('csv');
  });

  it('el BOM no llega al contenido decodificado: ambos producen el MISMO texto', () => {
    const sinBom = Buffer.from(CSV, 'utf8');
    const conBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(CSV, 'utf8'),
    ]);
    // Sin esto, el primer encabezado sería "\uFEFFsku" y la columna `sku`
    // "faltaría" en un archivo exportado por Excel, que siempre escribe BOM.
    expect(decodeCsv(conBom)).toBe(decodeCsv(sinBom));
    expect(decodeCsv(conBom).startsWith('sku,')).toBe(true);
  });

  it('un ejecutable renombrado a .csv se rechaza con 415, no se trata como texto', () => {
    // `7f 45 4c 46` es la cabecera ELF. Es UTF-8 VÁLIDO (0x7f es DEL), así que
    // el decodificador solo no alcanza: hace falta el chequeo de bytes de control.
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(() => detectFormat(elf, 'catalogo.csv')).toThrow(
      UnsupportedFormatError,
    );
    expect(() => detectFormat(elf, 'catalogo.csv')).toThrow(
      expect.objectContaining({
        status: 415,
        type: 'dsm:import/unsupported-format',
      }),
    );
  });

  it('un binario con NUL se rechaza con 415 aunque el Content-Type diga text/csv', () => {
    // El `Content-Type` ni entra en la función: es atacante-controlado y no es
    // evidencia de nada. Sólo el contenido decide.
    const binario = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a]);
    expect(() => detectFormat(binario, 'catalogo.csv')).toThrow(
      UnsupportedFormatError,
    );
  });

  it('un CSV en windows-1252 se rechaza con 422 y NO se decodifica con reemplazos', () => {
    const latin1 = Buffer.from('sku,nombre\nREF-1,Refrigeración\n', 'latin1');
    // El 0xF3 suelto de la "ó" en latin1 no es UTF-8 válido.
    expect(latin1.includes(0xf3)).toBe(true);
    expect(() => detectFormat(latin1, 'catalogo.csv')).toThrow(
      InvalidEncodingError,
    );
    expect(() => decodeCsv(latin1)).toThrow(
      expect.objectContaining({
        status: 422,
        type: 'dsm:import/invalid-encoding',
      }),
    );
    // La prueba de que rechazamos en vez de reparar: nadie ve un `�`.
    let texto: string | null = null;
    try {
      texto = decodeCsv(latin1);
    } catch {
      texto = null;
    }
    expect(texto).toBeNull();
  });

  it('el texto UTF-8 con acentos se decodifica intacto (sin U+FFFD)', () => {
    const buffer = Buffer.from(CSV, 'utf8');
    const texto = decodeCsv(buffer);
    expect(texto).toContain('Refrigeración');
    expect(texto).not.toContain('\uFFFD');
  });

  it('acepta tabulador, LF y CR como texto legítimo de un CSV', () => {
    const conTabs = Buffer.from('sku\tnombre\r\nREF-1\tHeladera\r\n', 'utf8');
    expect(detectFormat(conTabs, 'catalogo.csv')).toBe('csv');
  });
});
