import { createHash } from 'node:crypto';
import { AiEmbedder, AiEnricher, EnrichInput } from '../src/ai/ports/ai.ports';
import { EMBEDDING_DIMS } from '../src/enrichment/ai/gemini-http.client';

/**
 * Doble determinista de los puertos de IA — **test-only, a propósito** (US-005 T1.4, D6).
 *
 * Vive en `test/` y **no** en `src/enrichment/ai/`: el árbol de producción no debe tener
 * ningún adapter capaz de inventar vectores. Si alguna vez uno se cuela ahí, la búsqueda
 * semántica va a «funcionar» devolviendo basura plausible y nadie lo va a notar hasta la
 * demo — por eso el Verify de T1.4 greppea `src/enrichment/ai/` buscando exactamente eso.
 *
 * Determinista por hash: el mismo texto produce siempre el mismo vector, así los tests de
 * kNN pueden aseverar un ORDEN de resultados en vez de conformarse con «devolvió algo».
 */
export class FakeAiProvider implements AiEmbedder, AiEnricher {
  /** El doble está disponible: es lo que permite ejercer el runner sin red ni clave. */
  readonly available = true;

  readonly modelVersion = 'fake-embed-1';
  /** Textos que se le pidieron, para aseverar que no se llamó al proveedor de más. */
  readonly embedCalls: string[] = [];
  readonly enrichCalls: EnrichInput[] = [];

  async embed(text: string): Promise<number[]> {
    this.embedCalls.push(text);
    return FakeAiProvider.vectorDe(text);
  }

  async enrich(input: EnrichInput): Promise<string> {
    this.enrichCalls.push(input);
    return `${input.name} — ${input.categoryName}. Se usa para tareas de ${input.categoryName.toLowerCase()}. También conocido como ${input.name.toLowerCase()}.`;
  }

  /**
   * Vector estable derivado del texto: se siembra un LCG con el SHA-256 del texto, así
   * dos corridas (y dos máquinas) producen exactamente el mismo vector.
   */
  static vectorDe(text: string): number[] {
    const hash = createHash('sha256').update(text, 'utf8').digest();
    let seed = hash.readUInt32BE(0) || 1;
    const v = Array.from({ length: EMBEDDING_DIMS }, () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0xffffffff - 0.5;
    });
    // Norma > 0 garantizada: el adapter real la exige y el fake respeta el mismo contrato.
    const norma = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return v.map((x) => x / norma);
  }
}
