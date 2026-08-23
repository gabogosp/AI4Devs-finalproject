import {
  blend,
  classify,
  interpretedAs,
  ScoredProduct,
  suggestedCategories,
} from './relevance';

/**
 * T2.1 — las decisiones de relevancia, ejercidas sin HTTP, sin Postgres y sin Gemini.
 *
 * Es donde vive el umbral que separa «encontré» de «creo que encontré». Tenerlo en funciones
 * puras es lo que permite recalibrarlo con la batería de relevancia en la mano en vez de
 * adivinar: un umbral escondido dentro de un service que necesita base y API key para
 * ejercerse es un umbral que nadie recalibra.
 */
describe('relevance — umbral, blend y fallback', () => {
  const producto = (
    slug: string,
    score: number,
    category_name: string | null = 'Fijaciones',
  ): ScoredProduct => ({
    slug,
    name: `Producto ${slug}`,
    price_ars_cents: 100_000,
    stock: 3,
    image_url: null,
    category_name,
    score,
  });

  describe('classify (D5)', () => {
    it('el mejor sobre el umbral ⇒ high', () => {
      expect(classify([producto('a', 0.9), producto('b', 0.2)], 0.55)).toBe('high');
    });

    it('hay resultados pero ninguno convence ⇒ low', () => {
      // La distinción entre `low` y `none` es la que le permite al frontend ser honesto:
      // mostrar resultados AVISANDO que no está seguro, en vez de presentarlos con la misma
      // seguridad que un match exacto.
      expect(classify([producto('a', 0.4), producto('b', 0.39)], 0.55)).toBe('low');
    });

    it('sin resultados ⇒ none', () => {
      expect(classify([], 0.55)).toBe('none');
    });

    it('el umbral es inclusivo: exactamente en el límite es high', () => {
      // Un `>` en vez de `>=` haría que el score que el PO eligió como aceptable quede
      // clasificado como dudoso. La frontera tiene que estar del lado que se declaró.
      expect(classify([producto('a', 0.55)], 0.55)).toBe('high');
    });

    it('mira el MEJOR, no el primero: un orden roto no puede degradar la confianza', () => {
      expect(classify([producto('a', 0.2), producto('b', 0.95)], 0.55)).toBe('high');
    });
  });

  describe('blend', () => {
    const vectorial = [producto('v1', 0.9), producto('v2', 0.7), producto('v3', 0.5)];
    const lexico = [producto('v3', 0.95), producto('l1', 0.8)];

    it('peso 0 devuelve EXACTAMENTE el orden vectorial', () => {
      // La garantía que hace de `SEARCH_LEXICAL_WEIGHT` una perilla segura: en 0 no cambia
      // absolutamente nada respecto de no tener blend.
      expect(blend(vectorial, lexico, 0).map((p) => p.slug)).toEqual(['v1', 'v2', 'v3']);
      expect(blend(vectorial, lexico, 0).map((p) => p.score)).toEqual([0.9, 0.7, 0.5]);
    });

    it('peso 1 devuelve EXACTAMENTE el orden léxico', () => {
      expect(blend(vectorial, lexico, 1).map((p) => p.slug)).toEqual(['v3', 'l1']);
    });

    it('un peso intermedio mezcla y reordena por el score combinado', () => {
      const mezcla = blend(vectorial, lexico, 0.5);

      // v3 estaba último en vectorial (0.5) pero primero en léxico (0.95): la mezcla lo sube.
      // Es el rescate del caso que el vector hace peor — un SKU o un nombre técnico exacto.
      expect(mezcla[0].slug).toBe('v3');
      expect(mezcla.find((p) => p.slug === 'v3')!.score).toBeCloseTo(0.725, 5);
    });

    it('un producto que sólo aparece por la vía léxica entra con score vectorial 0', () => {
      const mezcla = blend(vectorial, lexico, 0.5);
      const soloLexico = mezcla.find((p) => p.slug === 'l1');

      expect(soloLexico).toBeDefined();
      expect(soloLexico!.score).toBeCloseTo(0.4, 5); // 0.5*0 + 0.5*0.8
    });

    it('no muta los arrays de entrada', () => {
      const v = [producto('a', 0.9)];
      const l = [producto('b', 0.5)];
      blend(v, l, 0.5);
      expect(v.map((p) => p.slug)).toEqual(['a']);
      expect(l.map((p) => p.slug)).toEqual(['b']);
    });
  });

  describe('suggestedCategories (AC-3)', () => {
    it('sin candidatos cae a las categorías raíz y NUNCA a lista vacía', () => {
      // Un «0 resultados» desnudo es un callejón sin salida: el cliente que lo ve no vuelve a
      // buscar, se va. La lista vacía no es un caso válido de esta función, es un bug.
      expect(suggestedCategories([], ['Fijaciones', 'Herramientas', 'Plomería'])).toEqual([
        'Fijaciones',
        'Herramientas',
        'Plomería',
      ]);
    });

    it('con candidatos usa sus categorías, sin repetir y en orden de ranking', () => {
      const candidatos = [
        producto('a', 0.4, 'Mechas y brocas'),
        producto('b', 0.3, 'Fijaciones'),
        producto('c', 0.2, 'Mechas y brocas'),
      ];

      expect(suggestedCategories(candidatos, ['Raíz'])).toEqual([
        'Mechas y brocas',
        'Fijaciones',
      ]);
    });

    it('ignora categorías vacías o en blanco en vez de ofrecerlas', () => {
      const candidatos = [producto('a', 0.4, null), producto('b', 0.3, '   ')];
      expect(suggestedCategories(candidatos, ['Fijaciones'])).toEqual(['Fijaciones']);
    });

    it('respeta el tope para no devolver un menú entero', () => {
      const muchas = ['A', 'B', 'C', 'D', 'E'].map((c, i) => producto(`p${i}`, 0.4, c));
      expect(suggestedCategories(muchas, [], 3)).toHaveLength(3);
    });
  });

  describe('interpretedAs (AC-8, OQ-BE-3)', () => {
    it('dice DÓNDE miró, con las categorías del top-N', () => {
      const top = [
        producto('a', 0.9, 'Fijaciones'),
        producto('b', 0.8, 'Mechas y brocas'),
        producto('c', 0.7, 'Fijaciones'),
      ];

      expect(interpretedAs(top)).toBe('Buscamos en: Fijaciones, Mechas y brocas');
    });

    it('sin categorías devuelve null en vez de una frase vacía', () => {
      expect(interpretedAs([])).toBeNull();
      expect(interpretedAs([producto('a', 0.9, null)])).toBeNull();
    });

    it('NO contiene el texto del usuario: el prompt-injection es estructural', () => {
      // AC-8 se cumple por construcción y no por sanitización: la interpretación se arma con
      // datos del CATÁLOGO, así que la consulta del cliente nunca llega a un modelo
      // generativo. No se puede inyectar un prompt en un modelo al que no se le habla.
      const top = [producto('a', 0.9, 'Fijaciones')];
      const texto = interpretedAs(top)!;

      expect(texto).not.toContain('ignora las instrucciones anteriores');
      expect(texto).toBe('Buscamos en: Fijaciones');
    });
  });
});
