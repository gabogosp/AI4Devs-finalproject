/**
 * Extraído literal de `imports/report-csv.ts` (Fowler Extract Function,
 * `per refactoring-discipline`, `design.md §D3`) — utilitario compartido sin
 * relación de negocio con `imports/` ni con `reports/`, sólo la neutralización
 * de celdas CSV que ambos exports necesitan.
 *
 * `security-standards.md` §6.3 — **encode for the destination context, at
 * output time**. Acá el destino no es HTML: es una planilla de cálculo. Excel
 * y Sheets evalúan como fórmula cualquier celda que empiece con `=`, `+`, `-`,
 * `@`, tab o CR, así que un texto libre como `=cmd|'/c calc'!A1` cargado por
 * un dueño (nombre de producto, SKU) se convertiría en ejecución de comandos
 * **en la máquina de quien abre el CSV**. El dato era válido, pero el peligro
 * lo introduciríamos nosotros al escribirlo sin neutralizar.
 */

const ARRANQUES_PELIGROSOS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Neutraliza la celda para que la planilla la trate como texto, y la
 * encomilla según RFC 4180 si hace falta.
 */
export function csvCell(valor: string | null | undefined): string {
  const texto = valor ?? '';
  const neutralizado =
    texto.length > 0 && ARRANQUES_PELIGROSOS.includes(texto[0])
      ? `'${texto}`
      : texto;

  // RFC 4180: se encomilla si hay coma, comilla, salto de línea o CR, y la
  // comilla interna se duplica.
  if (/[",\n\r]/.test(neutralizado)) {
    return `"${neutralizado.replace(/"/g, '""')}"`;
  }
  return neutralizado;
}
