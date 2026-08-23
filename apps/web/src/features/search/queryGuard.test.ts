import { describe, expect, it } from 'vitest';
import { MIN_CARACTERES_UTILES, esConsultaUtil, normalizar } from './queryGuard';

describe('normalizar', () => {
  it('recorta los extremos y colapsa los espacios internos', () => {
    expect(normalizar('  taco   fischer  ')).toBe('taco fischer');
    expect(normalizar('mecha\t\tde 8mm')).toBe('mecha de 8mm');
  });

  it('NO baja a minúsculas: el eco tiene que devolver lo que el cliente escribió', () => {
    // El servidor sí normaliza a minúsculas, pero para su clave de caché. Acá el
    // texto normalizado es el que se muestra de vuelta en pantalla, y
    // devolverle la consulta en minúsculas es corregirle cómo escribe.
    expect(normalizar('Taco Fischer SX')).toBe('Taco Fischer SX');
  });

  it('deja intacta una consulta que ya está normalizada', () => {
    expect(normalizar('taladro percutor')).toBe('taladro percutor');
  });
});

describe('esConsultaUtil', () => {
  it('rechaza el vacío, los espacios y un solo carácter útil', () => {
    expect(esConsultaUtil('')).toBe(false);
    expect(esConsultaUtil('   ')).toBe(false);
    expect(esConsultaUtil('a')).toBe(false);
    // El caso que justifica normalizar ANTES de medir: con `trim` a mano en el
    // llamador esto pasaría por tener cinco caracteres.
    expect(esConsultaUtil('  a  ')).toBe(false);
  });

  it('rechaza null y undefined sin explotar (la URL puede no traer `q`)', () => {
    expect(esConsultaUtil(null)).toBe(false);
    expect(esConsultaUtil(undefined)).toBe(false);
  });

  it('acepta desde dos caracteres útiles', () => {
    expect(MIN_CARACTERES_UTILES).toBe(2);
    // «M8» y «T5» son consultas reales en una ferretería: un mínimo de tres las
    // dejaría afuera.
    expect(esConsultaUtil('M8')).toBe(true);
    expect(esConsultaUtil('  M8  ')).toBe(true);
    expect(esConsultaUtil('taco para pared de hormigón')).toBe(true);
  });
});
