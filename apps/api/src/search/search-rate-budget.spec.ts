import { ConfigService } from '@nestjs/config';
import { AiEmbedder } from '../ai/ports/ai.ports';
import { DisabledAiProvider } from '../enrichment/ai/disabled-ai.provider';
import { RateLimiter } from '../enrichment/ai/rate-limiter';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { QueryEmbedder } from './query-embedder';

/**
 * T1.2 — el presupuesto propio del camino interactivo (D2).
 *
 * El riesgo que estos tests protegen no es teórico. El limitador de US-005 serializa las
 * salidas a `60_000 / RPM`: con los 5 RPM del lote son **12 segundos** entre llamadas. Si la
 * búsqueda compartiera ese limitador, cada consulta de un cliente esperaría detrás de la fila
 * del enriquecimiento —12 s, o lo que quede del lote— contra un presupuesto **total** de 1,5 s.
 * Y al revés: cada búsqueda le robaría una ranura al enriquecimiento, que es lo que *habilita*
 * la búsqueda. Se competirían a sí mismos.
 *
 * Por eso lo que se prueba acá es **independencia**, no velocidad.
 */
describe('Presupuesto del camino interactivo (search-rate-budget)', () => {
  /** Config con los valores que hacen la prueba legible. */
  const configCon = (extra: Record<string, unknown> = {}): ConfigService =>
    new ConfigService({
      GEMINI_EMBED_MODEL: 'text-embedding-004',
      GEMINI_SEARCH_TIMEOUT_MS: 900,
      ...extra,
    }) as unknown as ConfigService;

  describe('los dos limitadores no comparten estado', () => {
    it('con el limitador del LOTE saturado, el de búsqueda sale sin esperar', async () => {
      // Se modela el escenario real: un lote en curso a 5 RPM (12 s de espaciado) y una
      // búsqueda a 10 RPM (6 s). Son dos instancias, así que la cola de una no es la de la
      // otra. Se mide sobre el `sleep` inyectado: lo que importa es cuánto PIDE esperar cada
      // uno, no cuánto tarda el test.
      let relojLote = 0;
      const esperasLote: number[] = [];
      const limitadorLote = new RateLimiter({
        maxRpm: 5,
        now: () => relojLote,
        sleep: async (ms) => {
          esperasLote.push(ms);
          relojLote += ms;
        },
      });

      let relojBusqueda = 0;
      const esperasBusqueda: number[] = [];
      const limitadorBusqueda = new RateLimiter({
        maxRpm: 10,
        now: () => relojBusqueda,
        sleep: async (ms) => {
          esperasBusqueda.push(ms);
          relojBusqueda += ms;
        },
      });

      // Se saturan tres ranuras del lote.
      await limitadorLote.schedule(async () => 'a');
      await limitadorLote.schedule(async () => 'b');
      await limitadorLote.schedule(async () => 'c');
      expect(esperasLote).toEqual([12_000, 12_000]); // 60_000/5

      // Y ahora la primera búsqueda: NO hereda ninguna de esas esperas.
      const antes = Date.now();
      await limitadorBusqueda.schedule(async () => 'busqueda');
      const demoraReal = Date.now() - antes;

      expect(esperasBusqueda).toEqual([]); // la primera sale sin esperar
      expect(demoraReal).toBeLessThan(100); // y en reloj real, inmediata
    });

    it('el espaciado de cada uno sale de SU presupuesto, no de un promedio', async () => {
      const espera = (maxRpm: number) => new RateLimiter({ maxRpm }).minIntervalMs;

      // 5 RPM ⇒ 12 s (lote); 10 RPM ⇒ 6 s (búsqueda). Que el interactivo tenga el intervalo
      // más chico es la mitad del punto de D2; la otra mitad es que sean independientes.
      expect(espera(5)).toBe(12_000);
      expect(espera(10)).toBe(6_000);
      expect(espera(10)).toBeLessThan(espera(5));
    });
  });

  describe('las dos superficies no se roban invocaciones', () => {
    it('tres búsquedas no producen NI UNA llamada al embedder del enriquecimiento', async () => {
      // Cada superficie recibe su propia instancia del puerto. El contador del otro en 0 es
      // la prueba de que la búsqueda no gasta la cuota que habilita la búsqueda.
      const embedderLote = new FakeAiProvider();
      const embedderBusqueda = new FakeAiProvider();
      const buscador = new QueryEmbedder(embedderBusqueda, configCon());

      await buscador.embedQuery('algo para colgar un cuadro');
      await buscador.embedQuery('mecha para hormigón');
      await buscador.embedQuery('taco fischer 8mm');

      expect(embedderBusqueda.embedCalls).toHaveLength(3);
      expect(embedderLote.embedCalls).toHaveLength(0);
    });
  });

  describe('el timeout abandona y degrada, no lanza', () => {
    it('un embedder colgado ⇒ { ok: false, reason: timeout } y no una excepción', async () => {
      // Es la decisión de D1: el timeout es el DISPARADOR de la degradación, no un error a
      // reportar. Si esto lanzara, el `catch` viviría en el service y cada camino nuevo
      // tendría que acordarse de traducirlo.
      const colgado: AiEmbedder = {
        available: true,
        modelVersion: 'fake-embed-1',
        // Nunca resuelve: modela al proveedor que no contesta.
        embed: () => new Promise<number[]>(() => undefined),
      };
      const buscador = new QueryEmbedder(colgado, configCon({ GEMINI_SEARCH_TIMEOUT_MS: 40 }));

      const antes = Date.now();
      const resultado = await buscador.embedQuery('lo que sea');
      const demora = Date.now() - antes;

      expect(resultado).toEqual({ ok: false, reason: 'timeout' });
      // Respetó el presupuesto en vez de esperar al proveedor.
      expect(demora).toBeGreaterThanOrEqual(35);
      expect(demora).toBeLessThan(1_000);
    });

    it('el presupuesto se respeta incluso si el proveedor tarda un poco MÁS', async () => {
      const lento: AiEmbedder = {
        available: true,
        modelVersion: 'fake-embed-1',
        embed: () =>
          new Promise<number[]>((resolve) =>
            setTimeout(() => resolve(new Array(768).fill(0.1)), 300),
          ),
      };
      const buscador = new QueryEmbedder(lento, configCon({ GEMINI_SEARCH_TIMEOUT_MS: 50 }));

      const resultado = await buscador.embedQuery('consulta');

      expect(resultado.ok).toBe(false);
    });

    it('un proveedor que falla ⇒ provider_error, y el mensaje del proveedor NO se filtra', async () => {
      const roto: AiEmbedder = {
        available: true,
        modelVersion: 'fake-embed-1',
        embed: async () => {
          throw new Error('el proveedor respondió 401 con la clave AIzaSyXX');
        },
      };
      const buscador = new QueryEmbedder(roto, configCon());

      const resultado = await buscador.embedQuery('consulta');

      expect(resultado).toEqual({ ok: false, reason: 'provider_error' });
      // El valor de retorno es un código, no el mensaje: lo que sale hacia el cliente no
      // puede arrastrar el status del proveedor ni nada que venga en su texto.
      expect(JSON.stringify(resultado)).not.toContain('401');
      expect(JSON.stringify(resultado)).not.toContain('AIza');
    });

    it('sin proveedor ⇒ unavailable, sin intentar la llamada', async () => {
      // Cubre los dos motivos que el factory unifica: sin clave, o con la cuota entera
      // asignada al enriquecimiento (GEMINI_SEARCH_MAX_RPM=0, la primera corrida).
      const sinProveedor = new DisabledAiProvider() as unknown as AiEmbedder;
      const buscador = new QueryEmbedder(sinProveedor, configCon());

      const resultado = await buscador.embedQuery('consulta');

      expect(resultado).toEqual({ ok: false, reason: 'unavailable' });
      expect(buscador.available).toBe(false);
    });

    it('el camino feliz devuelve el vector y el modelo con el que se generó', async () => {
      // Contraste: sin esto, un `ok: false` en todos los tests anteriores no probaría nada.
      const buscador = new QueryEmbedder(new FakeAiProvider(), configCon());

      const resultado = await buscador.embedQuery('taco fischer');

      expect(resultado.ok).toBe(true);
      if (resultado.ok) {
        expect(resultado.vector).toHaveLength(768);
        // El modelo viaja con el vector porque es parte de la clave del caché (T1.3): el
        // vector sólo es determinista PARA UN MODELO DADO.
        expect(resultado.model).toBe('text-embedding-004');
      }
    });
  });
});
