import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { AiTransientError } from '../common/errors/enrichment-errors';
import {
  EnrichmentEventName,
  EnrichmentEventsService,
} from './enrichment-events.service';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentRunner } from './enrichment.runner';
import { EnrichmentService } from './enrichment.service';

/**
 * T5.1 — los 9 eventos del enriquecimiento (enrichment-events).
 *
 * Dos propiedades que se pierden solas si nadie las prueba:
 *
 * 1. **Cardinalidad acotada**: el `Map` de contadores tiene una clave por NOMBRE de evento.
 *    Si el `product_id` fuera dimensión, un catálogo de 5.000 productos crearía 5.000 series
 *    temporales y el backend de métricas costaría más que el enriquecimiento.
 * 2. **Longitudes, no textos**: el payload lleva `prompt_chars` y `response_chars`. Alcanza
 *    para estimar el gasto (la API del proveedor no siempre devuelve tokens) sin que los logs
 *    se conviertan en una copia parcial del catálogo del cliente.
 */
describe('EnrichmentEventsService — los 9 eventos (enrichment-events)', () => {
  const LOS_NUEVE: EnrichmentEventName[] = [
    'enrichment.run_started',
    'enrichment.product_enriched',
    'enrichment.embedding_generated',
    'enrichment.skipped_unchanged',
    'enrichment.skipped_curated',
    'enrichment.retried',
    'enrichment.abandoned',
    'enrichment.provider_unavailable',
    'enrichment.run_finished',
  ];

  describe('el servicio', () => {
    it('emite y cuenta los 9 nombres', () => {
      const events = new EnrichmentEventsService();
      for (const nombre of LOS_NUEVE) events.emit(nombre, null);

      for (const nombre of LOS_NUEVE) expect(events.count(nombre)).toBe(1);
      expect(events.cardinalidad).toBe(9);
    });

    it('CARDINALIDAD ACOTADA: 500 productos distintos ⇒ UNA sola clave de contador', () => {
      const events = new EnrichmentEventsService();

      for (let i = 0; i < 500; i += 1) {
        events.emit('enrichment.product_enriched', `producto-${i}`);
      }

      expect(events.count('enrichment.product_enriched')).toBe(500);
      // Lo que importa: el mapa tiene 1 clave, no 500. El id vive en el log, que es donde se
      // investiga un caso puntual.
      expect(events.cardinalidad).toBe(1);
    });

    it('el log lleva el product_id y los campos extra, sin inventar un actor', () => {
      const events = new EnrichmentEventsService();
      const capturado: unknown[] = [];
      jest
        .spyOn(events['logger'], 'log')
        .mockImplementation((payload: unknown) => void capturado.push(payload));

      events.emit('enrichment.product_enriched', 'p-1', {
        prompt_chars: 42,
        response_chars: 300,
      });
      events.emit('enrichment.run_started', null, { force: false });

      expect(capturado[0]).toMatchObject({
        event: 'enrichment.product_enriched',
        product_id: 'p-1',
        prompt_chars: 42,
        response_chars: 300,
      });
      // Los eventos de la CORRIDA no tienen producto: poner un id falso ahí haría que una
      // consulta por producto devuelva ruido.
      expect(capturado[1]).toMatchObject({
        event: 'enrichment.run_started',
        product_id: null,
      });
    });
  });

  describe('emitidos en sus puntos reales (integration)', () => {
    const prisma = new PrismaService();
    const corrida = idDeCorrida();
    let n = 0;

    beforeAll(async () => {
      await prisma.$connect();
    });
    afterAll(async () => {
      await prisma.$disconnect();
    });

    function armar(env: Record<string, unknown> = {}, proveedor = new FakeAiProvider()) {
      for (const [k, v] of Object.entries(env)) process.env[k] = String(v);
      const config = new ConfigService({}) as ConfigService;
      const events = new EnrichmentEventsService();
      const repo = new EnrichmentRepository(prisma, config);
      const service = new EnrichmentService(
        prisma,
        repo,
        config,
        proveedor,
        proveedor,
        events,
      );
      const runner = new EnrichmentRunner(
        repo,
        service,
        config,
        proveedor,
        proveedor,
        events,
      );
      return { runner, service, repo, events, proveedor };
    }

    async function sembrar(cantidad: number): Promise<string[]> {
      const categoryId = await asegurarCategoria(
        prisma,
        `ev-${corrida}`,
        `Eventos ${corrida}`,
      );
      const ids: string[] = [];
      for (let i = 0; i < cantidad; i += 1) {
        n += 1;
        const clave = `EV-${corrida}-${n}`;
        const p = await prisma.product.create({
          data: {
            sku: clave,
            slug: clave.toLowerCase(),
            name: `Producto ${clave}`,
            price_ars_cents: 100_000,
            stock: 1,
            status: 'published',
            category_id: categoryId,
            description_raw: 'descripcion pobre',
          },
        });
        ids.push(p.id);
      }
      return ids;
    }

    /** Deja fuera de la cola lo ajeno, para contar eventos de MI corrida. */
    async function aislarCola(): Promise<void> {
      await prisma.$executeRawUnsafe(
        `UPDATE products SET enrichment_next_attempt_at = now() + interval '1 hour'
          WHERE enrichment_done = false AND sku NOT LIKE $1`,
        `EV-${corrida}-%`,
      );
    }

    it('una corrida de 3 productos ⇒ run_started 1, product_enriched 3, run_finished 1', async () => {
      await sembrar(3);
      await aislarCola();
      const { runner, events } = armar({ ENRICHMENT_ENABLED: 'true' });

      await runner.start();

      expect(events.count('enrichment.run_started')).toBe(1);
      expect(events.count('enrichment.product_enriched')).toBe(3);
      expect(events.count('enrichment.embedding_generated')).toBe(3);
      expect(events.count('enrichment.run_finished')).toBe(1);
    });

    it('product_enriched lleva LONGITUDES y no el texto', async () => {
      // Es la diferencia entre poder estimar el gasto y tener una copia del catálogo del
      // cliente en los logs.
      const [id] = await sembrar(1);
      await aislarCola();
      const { runner, events } = armar({ ENRICHMENT_ENABLED: 'true' });
      const capturado: Array<Record<string, unknown>> = [];
      jest
        .spyOn(events['logger'], 'log')
        .mockImplementation((p: unknown) =>
          void capturado.push(p as Record<string, unknown>),
        );

      await runner.start();

      const enriquecido = capturado.find(
        (e) => e.event === 'enrichment.product_enriched' && e.product_id === id,
      );
      expect(enriquecido).toBeDefined();
      expect(typeof enriquecido!.prompt_chars).toBe('number');
      expect(typeof enriquecido!.response_chars).toBe('number');
      expect((enriquecido!.response_chars as number)).toBeGreaterThan(0);
      // Ningún campo del payload contiene el texto de la descripción.
      const serializado = JSON.stringify(enriquecido);
      expect(serializado).not.toContain('descripcion pobre');
      expect(serializado).not.toContain('Producto EV-');
    });

    it('un texto sin cambios emite skipped_unchanged y NO product_enriched', async () => {
      const [id] = await sembrar(1);
      await aislarCola();
      const primera = armar({ ENRICHMENT_ENABLED: 'true' });
      await primera.runner.start();

      // Segunda corrida sobre el mismo producto, sin que nada haya cambiado.
      await prisma.$executeRawUnsafe(
        `UPDATE products SET enrichment_done = false, enrichment_next_attempt_at = NULL
          WHERE id = $1::uuid`,
        id,
      );
      const segunda = armar({ ENRICHMENT_ENABLED: 'true' });
      await segunda.runner.start();

      expect(segunda.events.count('enrichment.skipped_unchanged')).toBe(1);
      expect(segunda.events.count('enrichment.product_enriched')).toBe(0);
      // Y el ahorro es real: cero llamadas al proveedor en la segunda corrida.
      expect(segunda.proveedor.enrichCalls).toHaveLength(0);
      expect(segunda.proveedor.embedCalls).toHaveLength(0);
    });

    it('un producto curado emite skipped_curated + embedding_generated', async () => {
      const [id] = await sembrar(1);
      await prisma.$executeRawUnsafe(
        `UPDATE products SET description_enriched = $2, description_curated = true
          WHERE id = $1::uuid`,
        id,
        'Texto que escribió el dueño.',
      );
      await aislarCola();
      const { runner, events, proveedor } = armar({ ENRICHMENT_ENABLED: 'true' });

      await runner.start();

      expect(events.count('enrichment.skipped_curated')).toBe(1);
      expect(events.count('enrichment.embedding_generated')).toBe(1);
      expect(events.count('enrichment.product_enriched')).toBe(0);
      expect(proveedor.enrichCalls).toHaveLength(0);
    });

    it('los fallos emiten retried, y el 5.º emite abandoned', async () => {
      const [id] = await sembrar(1);
      const { service, events } = armar({ ENRICHMENT_ENABLED: 'true' });

      for (let i = 0; i < 5; i += 1) {
        await service.registerFailure(id, 'dsm:enrichment/ai-transient');
      }

      // Cuatro reintentos y UN abandono: son eventos distintos porque disparan acciones
      // distintas — el abandono se mira en el runbook, el reintento es ruido esperable.
      expect(events.count('enrichment.retried')).toBe(4);
      expect(events.count('enrichment.abandoned')).toBe(1);
    });

    it('el breaker emite provider_unavailable con el motivo y el cooldown', async () => {
      await sembrar(6);
      await aislarCola();
      const roto = new FakeAiProvider();
      jest.spyOn(roto, 'embed').mockRejectedValue(new AiTransientError('caído'));
      const { runner, events } = armar(
        {
          ENRICHMENT_ENABLED: 'true',
          ENRICHMENT_CONCURRENCY: 1,
          ENRICHMENT_FAILURE_THRESHOLD: 3,
        },
        roto,
      );

      await runner.start();

      expect(events.count('enrichment.provider_unavailable')).toBe(1);
      expect(runner.state).toBe('cooldown');
    });

    it('sin proveedor, la corrida emite provider_unavailable y ningún evento de producto', async () => {
      await sembrar(2);
      const { runner, events } = armar({ ENRICHMENT_ENABLED: 'false' });

      await runner.start();

      expect(events.count('enrichment.provider_unavailable')).toBe(1);
      expect(events.count('enrichment.run_started')).toBe(0);
      expect(events.count('enrichment.product_enriched')).toBe(0);
    });

    it('run_finished se emite incluso si la corrida explota', async () => {
      // Un `run_started` sin su `run_finished` haría imposible distinguir «sigue corriendo»
      // de «murió a mitad de camino».
      await sembrar(1);
      await aislarCola();
      const { runner, events, repo } = armar({ ENRICHMENT_ENABLED: 'true' });
      jest.spyOn(repo, 'claimBatch').mockRejectedValue(new Error('la base se cayó'));

      await expect(runner.start()).rejects.toThrow('la base se cayó');

      expect(events.count('enrichment.run_started')).toBe(1);
      expect(events.count('enrichment.run_finished')).toBe(1);
    });
  });
});
