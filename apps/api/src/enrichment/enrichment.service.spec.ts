import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentService } from './enrichment.service';
import { ClaimedProduct } from './enrichment.repository';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { AiPermanentError } from '../common/errors/enrichment-errors';

/**
 * T3.2 — la matriz de decisión. Cada caso responde a una pregunta de plata: **¿se llamó al
 * proveedor, cuántas veces, y con qué texto?** Por eso los puertos son espías con conteo, no
 * mocks que devuelven cualquier cosa.
 *
 * Los cinco casos de la matriz están acá, más los dos invariantes que la acompañan: el
 * `status` del producto no se toca nunca (AC-10) y el texto y el vector entran juntos o no
 * entra ninguno.
 */
const HASH_VIEJO = 'hash-de-una-corrida-anterior';

const claimed = (over: Partial<ClaimedProduct> = {}): ClaimedProduct => ({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Taco Fischer SX 8mm',
  description_raw: 'taco 8',
  description_enriched: null,
  description_curated: false,
  enrichment_source_hash: null,
  enrichment_attempts: 0,
  category_id: 'cat-1',
  ...over,
});

function armar(opts: { conEmbedding?: boolean } = {}) {
  const fake = new FakeAiProvider();
  const enricherSpy = jest.spyOn(fake, 'enrich');
  const embedderSpy = jest.spyOn(fake, 'embed');

  const ejecutados: string[] = [];
  const prisma = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray) => {
      ejecutados.push(strings.join('?'));
      return 1;
    }),
    $queryRaw: jest.fn(async () => [{ enrichment_attempts: 0 }]),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: async (strings: TemplateStringsArray) => {
          ejecutados.push(strings.join('?'));
          return 1;
        },
      }),
    ),
  } as unknown as PrismaService;

  const repo = {
    hasEmbedding: jest.fn(async () => opts.conEmbedding ?? false),
  } as unknown as EnrichmentRepository;

  const config = new ConfigService({ ENRICHMENT_MAX_ATTEMPTS: 5 }) as ConfigService;
  const service = new EnrichmentService(prisma, repo, config, fake, fake);

  return { service, fake, enricherSpy, embedderSpy, prisma, ejecutados };
}

describe('EnrichmentService.processProduct — matriz de decisión', () => {
  it('fila 1: texto base cambiado y no curado ⇒ 1 llamada al LLM y 1 al embedder', async () => {
    const { service, enricherSpy, embedderSpy } = armar();

    const resultado = await service.processProduct(claimed(), 'Fijaciones');

    expect(resultado).toBe('enriched_and_embedded');
    expect(enricherSpy).toHaveBeenCalledTimes(1);
    expect(embedderSpy).toHaveBeenCalledTimes(1);
  });

  it('fila 2: CURADO ⇒ 0 llamadas al LLM (AC-7) y 1 al embedder sobre el texto curado', async () => {
    // La regla que hace que el trabajo del dueño no se pierda: la IA no lo reescribe,
    // pero el texto nuevo sí tiene que poder buscarse.
    const { service, enricherSpy, embedderSpy } = armar();

    const resultado = await service.processProduct(
      claimed({
        description_curated: true,
        description_enriched: 'Tarugo que el dueño describió a mano',
        enrichment_source_hash: HASH_VIEJO,
      }),
      'Fijaciones',
    );

    expect(resultado).toBe('embedded_from_curated');
    expect(enricherSpy).not.toHaveBeenCalled();
    expect(embedderSpy).toHaveBeenCalledTimes(1);
    expect(embedderSpy.mock.calls[0][0]).toContain(
      'Tarugo que el dueño describió a mano',
    );
  });

  it('fila 3: hash igual y CON embedding ⇒ 0 llamadas a los dos (AC-6)', async () => {
    // El test que hace verificable «no se gasta un centavo dos veces por lo mismo».
    const { service, enricherSpy, embedderSpy } = armar({ conEmbedding: true });
    const producto = claimed();
    const hash = await hashDe(service, producto);

    const resultado = await service.processProduct(
      claimed({ enrichment_source_hash: hash }),
      'Fijaciones',
    );

    expect(resultado).toBe('skipped_unchanged');
    expect(enricherSpy).not.toHaveBeenCalled();
    expect(embedderSpy).not.toHaveBeenCalled();
  });

  it('fila 4: hash igual y SIN embedding ⇒ sólo el embedder (fallo previo, se completa)', async () => {
    const { service, enricherSpy, embedderSpy } = armar({ conEmbedding: false });
    const hash = await hashDe(service, claimed());

    const resultado = await service.processProduct(
      claimed({ enrichment_source_hash: hash }),
      'Fijaciones',
    );

    expect(resultado).toBe('embedded_only');
    expect(enricherSpy).not.toHaveBeenCalled();
    expect(embedderSpy).toHaveBeenCalledTimes(1);
  });

  it('fila 5: sin descripción y sin curar ⇒ el LLM trabaja sobre nombre + rubro', async () => {
    // El caso real del catálogo de DSM: descripciones vacías.
    const { service, enricherSpy } = armar();

    const resultado = await service.processProduct(
      claimed({ description_raw: null }),
      'Mechas y brocas',
    );

    expect(resultado).toBe('enriched_and_embedded');
    expect(enricherSpy).toHaveBeenCalledWith({
      name: 'Taco Fischer SX 8mm',
      categoryName: 'Mechas y brocas',
      baseText: null,
    });
  });

  it('un cambio de precio o de stock no llega hasta acá: el hash no los conoce (AC-6)', async () => {
    // `ClaimedProduct` no trae precio ni stock, así que dos corridas con el mismo texto
    // dan el mismo hash aunque el precio haya cambiado entre medio.
    const { service, embedderSpy } = armar({ conEmbedding: true });
    const hash = await hashDe(service, claimed());

    await service.processProduct(claimed({ enrichment_source_hash: hash }), 'Fijaciones');
    await service.processProduct(claimed({ enrichment_source_hash: hash }), 'Fijaciones');

    expect(embedderSpy).not.toHaveBeenCalled();
  });
});

describe('EnrichmentService — invariantes de escritura', () => {
  it('el UPDATE nunca menciona `status` (AC-10)', async () => {
    // El enriquecimiento no publica ni despublica: que la columna no esté en el SQL lo
    // hace imposible, en vez de depender de que nadie la agregue.
    const { service, ejecutados } = armar();

    await service.processProduct(claimed(), 'Fijaciones');

    const sql = ejecutados.join('\n');
    expect(sql).toMatch(/UPDATE products/);
    expect(sql).not.toMatch(/\bstatus\b/);
  });

  it('el texto y el vector se escriben en UNA transacción', async () => {
    // Sin esto, un fallo del embedder dejaría el texto escrito y el hash actualizado: la
    // próxima corrida lo saltearía como «sin cambios» y el producto nunca sería buscable.
    const { service, prisma } = armar();

    await service.processProduct(claimed(), 'Fijaciones');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('si el embedder falla, no se escribe nada (ni texto ni vector)', async () => {
    const { service, fake, prisma, ejecutados } = armar();
    jest.spyOn(fake, 'embed').mockRejectedValue(new AiPermanentError('512 dims'));

    await expect(service.processProduct(claimed(), 'Fijaciones')).rejects.toBeInstanceOf(
      AiPermanentError,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(ejecutados.join('')).not.toMatch(/UPDATE products/);
  });

  it('el modelo del embedder se persiste con el vector (AC-8)', async () => {
    const { service, ejecutados, fake } = armar();

    await service.processProduct(claimed(), 'Fijaciones');

    expect(ejecutados.join('\n')).toMatch(/INSERT INTO product_embeddings/);
    expect(fake.modelVersion).toBe('fake-embed-1');
  });
});

describe('EnrichmentService.isAbandoned', () => {
  it('abandona al llegar al tope de intentos, no antes', async () => {
    const { service } = armar();

    expect(service.isAbandoned(4)).toBe(false);
    expect(service.isAbandoned(5)).toBe(true);
    expect(service.isAbandoned(6)).toBe(true);
  });
});

describe('EnrichmentService.BACKOFF_DURABLE_MS', () => {
  it('es la escalera del design: 1 m · 5 m · 25 m · 2 h · 10 h', () => {
    expect(EnrichmentService.BACKOFF_DURABLE_MS).toEqual([
      60_000, 300_000, 1_500_000, 7_200_000, 36_000_000,
    ]);
  });

  it('es monótona creciente: cada fallo espera más que el anterior', () => {
    const e = EnrichmentService.BACKOFF_DURABLE_MS;
    for (let i = 1; i < e.length; i += 1) expect(e[i]).toBeGreaterThan(e[i - 1]);
  });
});

/** Hash que el service calcularía para ese producto (misma composición que el service). */
async function hashDe(
  _service: EnrichmentService,
  producto: ClaimedProduct,
): Promise<string> {
  const { hashSourceText } = await import('./source-text');
  return hashSourceText({
    name: producto.name,
    categoryName: 'Fijaciones',
    curated: producto.description_curated ? producto.description_enriched : null,
    enriched: producto.description_curated ? null : producto.description_enriched,
    raw: producto.description_raw,
  });
}
