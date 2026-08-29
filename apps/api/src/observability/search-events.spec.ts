import { MetricsService } from './metrics.service';
import { SearchEventName, SearchEventsService } from './search-events.service';

/**
 * T4.1 — los eventos de la búsqueda (search-events).
 *
 * Los dos tests que justifican el archivo son el de **cardinalidad** y el de **forma del log**.
 * El primero protege el backend de métricas: un buscador genera consultas ilimitadas por
 * definición, así que una etiqueta por consulta no es «alta cardinalidad» sino infinita. El
 * segundo protege la decisión inversa: el texto **sí** va al log, porque es la única fuente del
 * KPI de relevancia y de la demanda no cubierta (OQ-BE-5).
 */
describe('SearchEventsService (search-events)', () => {
  const LOS_SEIS: SearchEventName[] = [
    'search.performed',
    'search.no_results',
    'search.low_confidence',
    'search.degraded',
    'search.cache_hit',
    'search.rate_limited',
  ];

  it('los 6 nombres se emiten y se cuentan por nombre', async () => {
    const metrics = new MetricsService();
    const events = new SearchEventsService(metrics);

    for (const nombre of LOS_SEIS) events.emit(nombre);

    for (const nombre of LOS_SEIS) {
      expect(await events.count(nombre)).toBe(1);
    }
  });

  it('el valor sale por el REGISTRO de Prometheus, no de un mapa privado', async () => {
    // Es la corrección de AUDIT-dsm-api-006: los contadores previos vivían en un `Map` que
    // nadie podía leer desde afuera, así que en producción eran invisibles. Lo que se prueba
    // acá es que el número es observable por `GET /v1/admin/metrics`.
    const metrics = new MetricsService();
    const events = new SearchEventsService(metrics);

    events.emit('search.performed', { query: 'taco fischer', resultCount: 3 });
    events.emit('search.degraded', { query: 'mecha widia' });

    const expuesto = await metrics.render();

    expect(expuesto).toContain('dsm_search_events_total');
    expect(expuesto).toMatch(/dsm_search_events_total\{event="search\.performed"\} 1/);
    expect(expuesto).toMatch(/dsm_search_events_total\{event="search\.degraded"\} 1/);
  });

  it('CARDINALIDAD: 50 consultas distintas dejan UN contador, no 50 series', async () => {
    // Un buscador genera consultas ilimitadas por definición. Si la consulta fuera etiqueta,
    // cada búsqueda nueva crearía una serie temporal y el backend de métricas se cae mucho
    // antes que el tráfico real.
    const metrics = new MetricsService();
    const events = new SearchEventsService(metrics);

    for (let i = 0; i < 50; i += 1) {
      events.emit('search.performed', { query: `consulta distinta número ${i}` });
    }

    expect(await events.count('search.performed')).toBe(50);

    const expuesto = await metrics.render();
    const series = expuesto
      .split('\n')
      .filter((l) => l.startsWith('dsm_search_events_total{'));
    expect(series).toHaveLength(1);
    expect(series[0]).toMatch(/\{event="search\.performed"\} 50$/);
    // Y ninguna serie menciona el texto de una consulta.
    expect(expuesto).not.toContain('consulta distinta');
  });

  it('la línea de log lleva exactamente los campos previstos y nada más', async () => {
    const metrics = new MetricsService();
    const events = new SearchEventsService(metrics);
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emit(
      'search.performed',
      { query: 'algo para colgar un cuadro', resultCount: 4, confidence: 'high', degraded: false },
      'trace-abc',
    );

    // Comparación de CONJUNTO de claves: si alguien agrega un campo sin pensarlo —un id de
    // cliente, una IP— este test se pone rojo antes de que llegue a un log de producción.
    expect(Object.keys(capturado[0]).sort()).toEqual([
      'confidence',
      'degraded',
      'event',
      'query',
      'result_count',
      'trace_id',
    ]);
    expect(capturado[0]).toMatchObject({
      event: 'search.performed',
      query: 'algo para colgar un cuadro',
      result_count: 4,
      confidence: 'high',
      degraded: false,
      trace_id: 'trace-abc',
    });
  });

  it('el texto de la consulta SÍ va al log: es la única fuente del KPI y de la demanda no cubierta', async () => {
    // La otra mitad de la decisión (OQ-BE-5). Sin la consulta en el log no hay forma de medir
    // relevancia ni de saber qué busca la gente que el catálogo no tiene — y eso último es
    // información que el negocio hoy no tiene de ninguna forma.
    const events = new SearchEventsService(new MetricsService());
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emit('search.no_results', { query: 'termofusora de 40mm', resultCount: 0 });

    expect(capturado[0].query).toBe('termofusora de 40mm');
    expect(capturado[0].result_count).toBe(0);
  });

  it('funciona sin MetricsService: la observabilidad no condiciona instanciar', async () => {
    // Precedente de CatalogEventsService: un unit test de una regla de búsqueda no tiene por
    // qué armar el registro de métricas para poder correr.
    const events = new SearchEventsService();

    expect(() => events.emit('search.performed', { query: 'x' })).not.toThrow();
    expect(await events.count('search.performed')).toBe(0);
  });
});
