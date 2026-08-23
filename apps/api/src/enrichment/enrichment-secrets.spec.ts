import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { GeminiHttpClient } from './ai/gemini-http.client';
import { EnrichmentEventsService } from './enrichment-events.service';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentRunner } from './enrichment.runner';
import { EnrichmentService } from './enrichment.service';
import { EnrichmentStatusResponseDto } from './dto/enrichment.dto';
import { PrismaService } from '../prisma/prisma.service';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';

/**
 * T5.2 — no-fuga de la clave del proveedor (AC-9, `security-standards` §5).
 *
 * La variante negativa que hay que **poder demostrar**, no afirmar. Se usa un canario: si el
 * valor de `GEMINI_API_KEY` aparece en cualquier log, en cualquier mensaje de excepción o en
 * el cuerpo del `/status`, este test se pone rojo.
 *
 * Por qué importa más que un checklist: una clave filtrada en un log no se revoca sola, y los
 * logs se copian a un agregador, a un ticket y a un chat. El día que alguien pegue el stack
 * trace de un 401 en un issue, la clave se va con él.
 */
describe('No-fuga de la clave del proveedor (enrichment-secrets)', () => {
  const CANARIO = 'super-secret-canary-value';
  const prisma = new PrismaService();
  const corrida = idDeCorrida();

  /** Todo lo que el proceso escribió por cualquier canal de log. */
  let logueado: string[] = [];
  const spies: jest.SpyInstance[] = [];
  const fetchOriginal = globalThis.fetch;

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.GEMINI_API_KEY = CANARIO;
    logueado = [];
    // Se capturan los CUATRO niveles: una clave que se escapa por `debug` está igual de
    // filtrada que una que se escapa por `error`.
    for (const nivel of ['log', 'warn', 'error', 'debug'] as const) {
      spies.push(
        jest
          .spyOn(Logger.prototype, nivel)
          .mockImplementation((...args: unknown[]) => {
            logueado.push(args.map((a) => JSON.stringify(a) ?? String(a)).join(' '));
          }),
      );
    }
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
    // `fetch` es GLOBAL: dejarlo mockeado rompe cualquier suite que corra después en el mismo
    // worker de Jest, con un error que no menciona este archivo. Pasó, y costó una corrida
    // completa entenderlo.
    globalThis.fetch = fetchOriginal;
    delete process.env.GEMINI_API_KEY;
  });

  /** Cliente apuntado a un stub local que responde el status pedido. */
  function clienteContra(status: number, cuerpo = '{}'): GeminiHttpClient {
    const fetchFalso = jest.fn().mockResolvedValue(
      new Response(cuerpo, {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchFalso as typeof fetch);
    return new GeminiHttpClient(new ConfigService({}) as ConfigService);
  }

  it('un 401 del proveedor no filtra la clave ni en el error ni en el log', async () => {
    // 401 es el caso más peligroso: es literalmente «tu clave está mal», y la tentación de
    // loguear la clave para diagnosticarlo es máxima.
    const cliente = clienteContra(401);

    let capturado: unknown;
    try {
      await cliente.embed('taco fischer 8mm');
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeDefined();
    const textoDelError = `${String(capturado)} ${(capturado as Error).stack ?? ''}`;
    expect(textoDelError).not.toContain(CANARIO);
    expect(logueado.join('\n')).not.toContain(CANARIO);
    // Y SÍ trae el status: sin eso el diagnóstico sería imposible y la regla de seguridad
    // se pagaría con ceguera operativa.
    expect(textoDelError).toContain('401');
  });

  it('un 500 del proveedor tampoco la filtra, y conserva el status', async () => {
    const cliente = clienteContra(500);

    let capturado: unknown;
    try {
      await cliente.embed('mecha widia');
    } catch (error) {
      capturado = error;
    }

    const textoDelError = `${String(capturado)} ${(capturado as Error).stack ?? ''}`;
    expect(textoDelError).not.toContain(CANARIO);
    expect(textoDelError).toContain('500');
    expect(logueado.join('\n')).not.toContain(CANARIO);
  });

  it('la clave viaja en el header y NUNCA en la URL', async () => {
    // Una clave en la query string queda en los logs de acceso de cada proxy del camino, en
    // el historial del navegador y en el `Referer`. El header no.
    const cliente = clienteContra(200, JSON.stringify({ embedding: { values: [] } }));

    await cliente.embed('amoladora').catch(() => undefined);

    const llamada = (globalThis.fetch as jest.Mock).mock.calls[0];
    const url = String(llamada[0]);
    expect(url).not.toContain(CANARIO);
    expect(url).not.toContain('key=');
    const headers = (llamada[1] as { headers: Record<string, string> }).headers;
    expect(headers['x-goog-api-key']).toBe(CANARIO);
  });

  it('una corrida completa con el proveedor caído no filtra la clave por ningún log', async () => {
    // El agregado de TODO lo emitido durante una corrida real: eventos, warnings del breaker,
    // errores del runner. Es el escenario del runbook, no un caso de laboratorio.
    const categoryId = await asegurarCategoria(
      prisma,
      `sec-${corrida}`,
      `Secretos ${corrida}`,
    );
    const clave = `SEC-${corrida}`;
    const producto = await prisma.product.create({
      data: {
        sku: clave,
        slug: clave.toLowerCase(),
        name: `Amoladora ${clave}`,
        price_ars_cents: 100_000,
        stock: 1,
        status: 'published',
        category_id: categoryId,
        description_raw: 'pobre',
      },
    });

    const cliente = clienteContra(401);
    const config = new ConfigService({}) as ConfigService;
    const events = new EnrichmentEventsService();
    const repo = new EnrichmentRepository(prisma, config);
    const service = new EnrichmentService(prisma, repo, config, cliente, cliente, events);
    const runner = new EnrichmentRunner(
      repo,
      service,
      config,
      cliente,
      cliente,
      events,
    );

    await runner.start({ productIds: [producto.id] });

    const todo = logueado.join('\n');
    expect(todo).not.toContain(CANARIO);
    expect(todo).not.toContain('key=');
    // Prueba de que la captura de logs funciona (si no, el assert de arriba sería vacío).
    expect(todo.length).toBeGreaterThan(0);
  });

  it('el body del /status no contiene la clave', () => {
    const dto = EnrichmentStatusResponseDto.from({
      runnerState: 'cooldown',
      coverage: {
        total: 10,
        enriched: 3,
        embedded: 3,
        pending: 7,
        abandoned: 0,
        coverage_ratio: 0.3,
      },
      enrichModel: 'gemini-1.5-flash',
      embedModel: 'text-embedding-004',
      lastErrorCode: 'dsm:enrichment/ai-permanent',
      lastRunAt: new Date('2026-08-23T12:00:00.000Z'),
    });

    const serializado = JSON.stringify(dto);
    expect(serializado).not.toContain(CANARIO);
    // El código de error sí está: es diagnóstico sin secreto adentro.
    expect(serializado).toContain('dsm:enrichment/ai-permanent');
  });
});
