import { normalizeEmail } from './normalize-email';

/**
 * T1.3 — la parte unitaria. La integración contra el UNIQUE de Postgres vive en
 * `customers.repository.spec.ts` (T2.1): acá se ancla el contrato de la función,
 * allá que la base efectivamente la respete.
 */
describe('normalizeEmail (§6)', () => {
  it('idempotente: normalizar lo ya normalizado no cambia nada', () => {
    const una = normalizeEmail('  Ana.Perez@Example.COM ');
    expect(normalizeEmail(una)).toBe(una);
  });

  it('las variantes de tipeo del mismo buzón colapsan en un valor', () => {
    expect(normalizeEmail('  Ana.Perez@Example.COM ')).toBe(
      'ana.perez@example.com',
    );
    expect(normalizeEmail('ANA.PEREZ@EXAMPLE.COM')).toBe(
      normalizeEmail('ana.perez@example.com'),
    );
  });

  it('NFKC: la "é" precompuesta y la descompuesta son la misma clave', () => {
    const precompuesta = 'josé@example.com'; // é
    const descompuesta = 'josé@example.com'; // e + acento combinante
    expect(precompuesta).not.toBe(descompuesta); // distintos como strings…
    expect(normalizeEmail(precompuesta)).toBe(normalizeEmail(descompuesta)); // …misma cuenta
  });

  it('NO quita puntos: cambiarían la identidad del buzón fuera de Gmail', () => {
    expect(normalizeEmail('juan.perez@midominio.com')).toBe(
      'juan.perez@midominio.com',
    );
    expect(normalizeEmail('juan.perez@midominio.com')).not.toBe(
      normalizeEmail('juanperez@midominio.com'),
    );
  });

  it('NO quita sufijos +tag', () => {
    expect(normalizeEmail('ana+compras@example.com')).toBe(
      'ana+compras@example.com',
    );
  });

  it('el espacio interno no se toca — sólo se recorta el de los extremos', () => {
    expect(normalizeEmail('\t ana@example.com \n')).toBe('ana@example.com');
  });
});
