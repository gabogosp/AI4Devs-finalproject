import { existsSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { AiDisabledError } from '../../common/errors/enrichment-errors';
import { AI_EMBEDDER, AI_ENRICHER, AiEmbedder, AiEnricher } from '../ports/ai.ports';
import { aiEmbedderProvider, aiEnricherProvider } from './ai.providers';
import { DisabledAiProvider } from './disabled-ai.provider';
import { GeminiHttpClient } from './gemini-http.client';
import { FakeAiProvider } from '../../../test/fake-ai.provider';

/**
 * T1.4 — la selección de adapter. El caso importante no es «con clave da Gemini», es
 * **sin clave no se hace una sola llamada de red**: `fetch` espiado tiene que quedar en
 * 0 invocaciones.
 */
type Factory = (c: ConfigService) => unknown;

const resolver = (env: Record<string, unknown>) => {
  const config = new ConfigService(env) as ConfigService;
  return {
    embedder: (aiEmbedderProvider as { useFactory: Factory }).useFactory(config),
    enricher: (aiEnricherProvider as { useFactory: Factory }).useFactory(config),
  };
};

describe('selección del proveedor de IA (ai.providers)', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sin GEMINI_API_KEY ⇒ DisabledAiProvider, y CERO llamadas de red', async () => {
    const { embedder } = resolver({});

    expect(embedder).toBeInstanceOf(DisabledAiProvider);
    await expect((embedder as AiEmbedder).embed('x')).rejects.toBeInstanceOf(
      AiDisabledError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sin clave, `enrich` también falla explícito', async () => {
    const { enricher } = resolver({});

    await expect(
      (enricher as AiEnricher).enrich({
        name: 'x',
        categoryName: 'y',
        baseText: null,
      }),
    ).rejects.toBeInstanceOf(AiDisabledError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('con ENRICHMENT_ENABLED=false ⇒ DisabledAiProvider aunque haya clave', () => {
    // El kill-switch tiene que poder apagar la feature sin sacar la credencial.
    const { embedder } = resolver({
      GEMINI_API_KEY: 'clave',
      ENRICHMENT_ENABLED: 'false',
    });

    expect(embedder).toBeInstanceOf(DisabledAiProvider);
  });

  it('con clave y habilitado ⇒ GeminiHttpClient', () => {
    const { embedder, enricher } = resolver({
      GEMINI_API_KEY: 'clave',
      ENRICHMENT_ENABLED: 'true',
    });

    expect(embedder).toBeInstanceOf(GeminiHttpClient);
    expect(enricher).toBeInstanceOf(GeminiHttpClient);
  });

  it('los dos puertos comparten instancia: un solo limitador de RPM', () => {
    // La cuota del free tier es compartida entre embeddings y texto: dos clientes
    // con dos limitadores duplicarían el presupuesto real de RPM.
    const { embedder, enricher } = resolver({ GEMINI_API_KEY: 'clave' });

    expect(embedder).toBe(enricher);
  });

  it('los tokens de DI son los del puerto, no strings', () => {
    expect((aiEmbedderProvider as { provide: symbol }).provide).toBe(AI_EMBEDDER);
    expect((aiEnricherProvider as { provide: symbol }).provide).toBe(AI_ENRICHER);
  });
});

describe('el fake determinista es test-only (D6)', () => {
  it('produce 768 dimensiones con norma 1 y es estable entre llamadas', async () => {
    const fake = new FakeAiProvider();

    const a = await fake.embed('taco fischer 8mm');
    const b = await fake.embed('taco fischer 8mm');
    const otro = await fake.embed('mecha widia 8mm');

    expect(a).toHaveLength(768);
    expect(a).toEqual(b); // determinista: el mismo texto, el mismo vector
    expect(a).not.toEqual(otro);
    const norma = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norma).toBeCloseTo(1, 6);
  });

  it('registra las llamadas para poder aseverar que no se gastó cuota de más', async () => {
    const fake = new FakeAiProvider();

    await fake.embed('uno');
    await fake.enrich({ name: 'dos', categoryName: 'Fijaciones', baseText: null });

    expect(fake.embedCalls).toEqual(['uno']);
    expect(fake.enrichCalls).toHaveLength(1);
  });

  it('NO vive en el árbol de producción', () => {
    // El Verify de la task greppea `src/enrichment/ai/`; esto lo ancla desde el test.
    expect(existsSync('test/fake-ai.provider.ts')).toBe(true);
    expect(existsSync('src/enrichment/ai/fake-ai.provider.ts')).toBe(false);
  });
});
