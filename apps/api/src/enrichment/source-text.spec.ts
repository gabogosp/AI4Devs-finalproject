import { readFileSync } from 'node:fs';
import { buildSourceText, hashSourceText, SourceTextInput } from './source-text';

/**
 * T3.1 — el control de costo de AC-6. Cada test de acá responde a «¿cuándo se gasta una
 * llamada paga al proveedor?», que es la única pregunta que este archivo decide.
 */
const base = (over: Partial<SourceTextInput> = {}): SourceTextInput => ({
  name: 'Taco Fischer SX 8mm',
  categoryName: 'Fijaciones',
  curated: null,
  enriched: null,
  raw: 'taco 8',
  ...over,
});

describe('buildSourceText — prioridad del texto', () => {
  it('el CURADO gana sobre el enriquecido y sobre el base (AC-7)', () => {
    const texto = buildSourceText(
      base({ curated: 'texto del dueño', enriched: 'texto de la IA', raw: 'taco 8' }),
    );

    expect(texto).toContain('texto del dueño');
    expect(texto).not.toContain('texto de la IA');
    expect(texto).not.toContain('taco 8');
  });

  it('el ENRIQUECIDO gana sobre el base cuando no hay curado', () => {
    const texto = buildSourceText(base({ enriched: 'texto de la IA', raw: 'taco 8' }));

    expect(texto).toContain('texto de la IA');
    expect(texto).not.toContain('taco 8');
  });

  it('usa el BASE cuando es lo único que hay', () => {
    expect(buildSourceText(base())).toContain('taco 8');
  });

  it('siempre incluye nombre y RUBRO (D3)', () => {
    // Sin el rubro, «Mecha widia 8» es casi ruido para el embedder.
    const texto = buildSourceText({
      name: 'Mecha widia 8mm',
      categoryName: 'Mechas y brocas',
      curated: null,
      enriched: null,
      raw: null,
    });

    expect(texto).toContain('Mecha widia 8mm');
    expect(texto).toContain('Mechas y brocas');
  });

  it('sin ninguna descripción compone nombre + rubro sin dejar separadores colgando', () => {
    // Es el caso real del catálogo de DSM: descripciones vacías.
    const texto = buildSourceText(base({ raw: null }));

    expect(texto).toBe('Taco Fischer SX 8mm. Fijaciones');
    expect(texto).not.toMatch(/\.\s*$/);
    expect(texto).not.toContain('..');
  });

  it('trata el texto vacío o de sólo espacios como ausente', () => {
    const texto = buildSourceText(base({ curated: '   ', enriched: '', raw: 'taco 8' }));

    expect(texto).toContain('taco 8');
  });
});

describe('hashSourceText — cuándo se gasta plata y cuándo no', () => {
  it('es estable entre invocaciones', () => {
    expect(hashSourceText(base())).toBe(hashSourceText(base()));
  });

  it('cambia si cambia el nombre', () => {
    expect(hashSourceText(base({ name: 'Otro nombre' }))).not.toBe(
      hashSourceText(base()),
    );
  });

  it('cambia si cambia el rubro', () => {
    expect(hashSourceText(base({ categoryName: 'Otro rubro' }))).not.toBe(
      hashSourceText(base()),
    );
  });

  it('cambia si cambia el texto elegido', () => {
    expect(hashSourceText(base({ raw: 'taco 10' }))).not.toBe(hashSourceText(base()));
  });

  it('NO cambia por diferencias de espacios ni por \\r\\n', () => {
    // Un cambio cosmético (alguien reindenta la descripción en el panel) no puede
    // disparar una llamada paga por cada producto del catálogo.
    const a = hashSourceText(base({ raw: 'taco  8\r\ncon tornillo' }));
    const b = hashSourceText(base({ raw: '  taco 8 con tornillo  ' }));

    expect(a).toBe(b);
  });

  it('el mismo texto en curado o en base produce el MISMO hash', () => {
    // Consecuencia útil: si el dueño «cura» pegando exactamente el texto que ya había,
    // no se gasta una llamada.
    expect(hashSourceText(base({ curated: 'taco 8', raw: null }))).toBe(
      hashSourceText(base({ raw: 'taco 8' })),
    );
  });

  it('es un SHA-256 en hex', () => {
    expect(hashSourceText(base())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('el precio y el stock NO pueden entrar al hash (AC-6)', () => {
  it('la firma no los declara: es imposible por construcción, no por convención', () => {
    // Si entraran, cada cambio de lista de precios re-enriquecería todo el catálogo.
    const fuente = readFileSync('src/enrichment/source-text.ts', 'utf8');
    const codigo = fuente
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(codigo).not.toMatch(/price/i);
    expect(codigo).not.toMatch(/\bstock\b/i);
    // Y el contrato sigue siendo el que se espera (el strip no vació el archivo).
    expect(codigo).toMatch(/interface SourceTextInput/);
  });

  it('el objeto de entrada tiene exactamente los 5 campos previstos', () => {
    const input = base();
    expect(Object.keys(input).sort()).toEqual(
      ['categoryName', 'curated', 'enriched', 'name', 'raw'].sort(),
    );
  });
});
