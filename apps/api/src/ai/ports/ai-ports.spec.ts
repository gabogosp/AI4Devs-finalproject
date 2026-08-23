import { readFileSync } from 'node:fs';
import {
  AI_EMBEDDER,
  AI_ENRICHER,
  AiEmbedder,
  AiEnricher,
  EnrichInput,
} from './ai.ports';

/**
 * T1.1 — los puertos. Un test de puertos no prueba comportamiento (no hay
 * implementación acá): prueba que **el contrato no filtra el proveedor**, que es lo
 * único que puede romperse al editarlos.
 *
 * Si mañana alguien agrega `apiKey` o `GenerateContentResponse` a una firma, el
 * dominio pasa a depender de Gemini y el adapter deja de ser reemplazable. Este spec
 * es el guardarraíl de eso.
 */
describe('puertos de IA (AI_ENRICHER / AI_EMBEDDER)', () => {
  it('los tokens son Symbols distintos y descriptivos', () => {
    expect(typeof AI_ENRICHER).toBe('symbol');
    expect(typeof AI_EMBEDDER).toBe('symbol');
    expect(AI_ENRICHER).not.toBe(AI_EMBEDDER);
    expect(String(AI_ENRICHER)).toContain('AI_ENRICHER');
    expect(String(AI_EMBEDDER)).toContain('AI_EMBEDDER');
  });

  it('un doble determinista satisface `AiEmbedder` sin tocar la red', async () => {
    // Es exactamente lo que van a hacer los tests de las fases siguientes: si el
    // puerto exigiera algo del proveedor, este doble no compilaría.
    const embedder: AiEmbedder = {
      available: true,
      modelVersion: 'fake-embed-1',
      embed: async (text) => Array.from({ length: 768 }, (_, i) => (i + text.length) / 1000),
    };

    const v = await embedder.embed('taco fischer');

    expect(v).toHaveLength(768);
    expect(embedder.modelVersion).toBe('fake-embed-1');
  });

  it('un doble satisface `AiEnricher` recibiendo sólo dato de catálogo', async () => {
    const enricher: AiEnricher = {
      available: true,
      enrich: async (input: EnrichInput) =>
        `${input.name} (${input.categoryName}) — ${input.baseText ?? 'sin descripción'}`,
    };

    const texto = await enricher.enrich({
      name: 'Mecha widia 8mm',
      categoryName: 'Mechas y brocas',
      baseText: null,
    });

    // El rubro entra al texto: sin él, «Mecha widia 8» es casi ruido (D3).
    expect(texto).toContain('Mechas y brocas');
  });

  it('la entrada del enriquecedor es dato de catálogo, no un prompt', () => {
    // El prompt lo arma el ADAPTER. Si `EnrichInput` tuviera un campo `prompt`, la
    // ingeniería de prompts se filtraría al dominio y a los tests de negocio.
    const input: EnrichInput = { name: 'x', categoryName: 'y', baseText: null };

    expect(Object.keys(input).sort()).toEqual([
      'baseText',
      'categoryName',
      'name',
    ]);
  });

  it('el CÓDIGO de los puertos no menciona al proveedor (la prosa sí puede)', () => {
    // Guardarraíl de acoplamiento: el dominio no puede aprender que existe Gemini.
    // Se quitan los comentarios antes de mirar: la documentación explica de qué se
    // desacopla —y eso es valioso—, mientras que un `import { GoogleGenerativeAI }`
    // o un campo `apiKey` en una firma serían el acoplamiento real.
    const fuente: string = readFileSync(
      'src/ai/ports/ai.ports.ts',
      'utf8',
    );
    const codigo = fuente
      .replace(/\/\*[\s\S]*?\*\//g, '') // bloques /** … */
      .replace(/\/\/.*$/gm, ''); // línea //

    expect(codigo).not.toMatch(/gemini/i);
    expect(codigo).not.toMatch(/\bfetch\b/);
    expect(codigo).not.toMatch(/apiKey|api_key|x-goog/i);
    // Y el contrato sigue estando ahí (el strip no vació el archivo por accidente).
    expect(codigo).toMatch(/interface AiEmbedder/);
    expect(codigo).toMatch(/interface AiEnricher/);
  });
});
