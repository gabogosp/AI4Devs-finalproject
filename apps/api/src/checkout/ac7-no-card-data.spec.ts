import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T5.2 — AC-7: imposibilidad ESTRUCTURAL de custodiar datos de tarjeta
 * (ADR-0006: el pago ocurre íntegramente en el checkout hosted de
 * MercadoPago). Agregar mañana un `card_last4` "para el comprobante" tiene
 * que romper esta suite, no pasar inadvertido.
 *
 * Dos superficies, la misma lista negra: las columnas REALES de `orders`/
 * `order_items` en Postgres, y los campos de los DTO del módulo (extraídos
 * del código fuente por regex — más robusto que la reflexión de
 * `class-validator`, que no ve `CheckoutResponseDto`: no tiene decoradores,
 * es un DTO de salida construido campo por campo).
 */
// SIN `\b`: `_` es carácter de palabra en regex, así que `\bcard\b` NO
// matchea `card_last4` (no hay borde de palabra entre 'd' y '_'). Substring
// simple: ningún nombre de campo legítimo del módulo contiene "card", "pan",
// "cvv", "cvc", "holder", "expiry" o "tarjeta" como subcadena.
const LISTA_NEGRA = /(card|pan|cvv|cvc|holder|expiry|exp_month|exp_year|tarjeta)/i;

describe('AC-7: imposibilidad estructural de custodiar datos de tarjeta (ac7-no-card-data)', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('ninguna columna real de orders/order_items matchea la lista negra', async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('orders', 'order_items')`,
    );

    const sospechosas = filas
      .map((f) => f.column_name)
      .filter((nombre) => LISTA_NEGRA.test(nombre));

    expect(sospechosas).toEqual([]);
  });

  it('ningún campo de los DTO del módulo matchea la lista negra', () => {
    const dtoDir = path.join(__dirname, 'dto');
    const campos: string[] = [];

    for (const archivo of fs.readdirSync(dtoDir)) {
      if (!archivo.endsWith('.dto.ts')) continue;
      const contenido = fs.readFileSync(path.join(dtoDir, archivo), 'utf8');
      // Declaraciones de campo: `  nombre!: tipo;` o `  nombre?: tipo;`, sin
      // decorador ni comentario en la misma línea.
      const matches = contenido.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*)[?!]?:\s/gm);
      for (const m of matches) campos.push(m[1]);
    }

    // Guardián de que el extractor efectivamente encontró algo: si el regex
    // dejara de matchear (p.ej. por un cambio de estilo en los DTO), este
    // test pasaría "verde" sin haber mirado ningún campo real.
    expect(campos.length).toBeGreaterThan(0);

    const sospechosos = campos.filter((c) => LISTA_NEGRA.test(c));
    expect(sospechosos).toEqual([]);
  });

  it('el test se prueba a sí mismo: una columna card_last4 sembrada a mano SÍ dispara el fallo', async () => {
    // Igual que el primer test, pero agregando a mano una columna que NO
    // existe en la base — prueba el mecanismo de filtrado, no la visibilidad
    // de una TEMP TABLE entre conexiones del pool (que Postgres no garantiza
    // y no es lo que este guard verifica).
    const filas = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('orders', 'order_items')`,
    );
    const columnas = [...filas.map((f) => f.column_name), 'card_last4'];

    const sospechosas = columnas.filter((nombre) => LISTA_NEGRA.test(nombre));

    expect(sospechosas).toEqual(['card_last4']);
  });

  it('el test se prueba a sí mismo: un campo cvv en un DTO literal SÍ dispara el fallo', () => {
    const dtoDeMentira = `
export class FakeDto {
  cvv!: string;
  nombre_valido!: string;
}
`;
    const campos = [
      ...dtoDeMentira.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*)[?!]?:\s/gm),
    ].map((m) => m[1]);
    const sospechosos = campos.filter((c) => LISTA_NEGRA.test(c));

    expect(sospechosos).toEqual(['cvv']);
  });
});
