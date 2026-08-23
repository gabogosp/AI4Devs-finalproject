import { normalizeQuery, usefulLength } from './normalize-query';

/**
 * T2.1 — la normalización, que decide dos cosas a la vez: qué consultas comparten entrada de
 * caché (y por lo tanto cuándo se gasta una llamada paga) y qué se rechaza por demasiado corta.
 */
describe('normalizeQuery / usefulLength', () => {
  it('recorta, colapsa espacios y baja a minúsculas', () => {
    expect(normalizeQuery('  Taco   FISCHER ')).toBe('taco fischer');
    // La longitud útil es la del texto normalizado: 'taco fischer' son 12 caracteres.
    expect(usefulLength('  Taco   FISCHER ')).toBe(12);
  });

  it('la longitud útil NO se puede inflar con espacios (AC-5)', () => {
    // Es lo que evita pagarle un embedding a una consulta que es un espacio en blanco.
    expect(usefulLength('   a   ')).toBe(1);
    expect(usefulLength('\t\n  ')).toBe(0);
    expect(usefulLength('')).toBe(0);
  });

  it('colapsa tabs y saltos de línea, no sólo espacios', () => {
    expect(normalizeQuery('taco\tfischer\n8mm')).toBe('taco fischer 8mm');
  });

  it('NO quita acentos: son consultas distintas para el embedder', () => {
    // Colapsarlas ahorraría una llamada al precio de devolver el vector equivocado. El caché
    // tiene que agrupar el mismo pedido escrito distinto, no lo que se parece.
    expect(normalizeQuery('mechá widiá')).toBe('mechá widiá');
    expect(normalizeQuery('mecha widia')).not.toBe(normalizeQuery('mechá widiá'));
  });

  it('es idempotente: normalizar lo normalizado no cambia nada', () => {
    // Importa porque la clave del caché se arma con esto: si no fuera idempotente, la misma
    // consulta podría caer en dos entradas distintas y pagar dos veces.
    const una = normalizeQuery('  Taco   FISCHER ');
    expect(normalizeQuery(una)).toBe(una);
  });

  it('conserva los números y los símbolos técnicos del rubro', () => {
    // «8mm», «1/2"» y «M6» son la mitad del vocabulario de una ferretería: si la
    // normalización los comiera, la búsqueda perdería justo las consultas más precisas.
    expect(normalizeQuery('Mecha 8mm')).toBe('mecha 8mm');
    expect(normalizeQuery('Caño 1/2"')).toBe('caño 1/2"');
    expect(normalizeQuery('Bulón M6 x 40')).toBe('bulón m6 x 40');
  });
});
