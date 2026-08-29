import { MetricsService } from './metrics.service';

/**
 * AUDIT-dsm-api-006 — estos tests ejercen el comportamiento, no la presencia: el
 * defecto que el finding describe era «los contadores existen pero nadie los puede
 * leer», así que lo que hay que probar es que el valor sale por `render()`.
 */
describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  it('cuenta por familia y por evento, y el valor sale en la exposición', async () => {
    metrics.increment('auth', 'auth.login_failed');
    metrics.increment('auth', 'auth.login_failed');
    metrics.increment('auth', 'auth.login_succeeded');
    metrics.increment('cart', 'cart.item_added');

    expect(await metrics.value('auth', 'auth.login_failed')).toBe(2);
    expect(await metrics.value('auth', 'auth.login_succeeded')).toBe(1);
    expect(await metrics.value('cart', 'cart.item_added')).toBe(1);

    // Lo que el finding pedía: que sea LEGIBLE desde afuera.
    const texto = await metrics.render();
    expect(texto).toContain(
      'dsm_auth_events_total{event="auth.login_failed"} 2',
    );
    expect(texto).toContain('dsm_cart_events_total{event="cart.item_added"} 1');
  });

  it('un evento nunca incrementado vale 0 y no rompe', async () => {
    metrics.increment('auth', 'auth.login_failed');
    expect(await metrics.value('auth', 'auth.logout')).toBe(0);
  });

  it('las familias son independientes: el mismo nombre de evento no se mezcla', async () => {
    metrics.increment('auth', 'x.same');
    metrics.increment('catalog', 'x.same');
    metrics.increment('catalog', 'x.same');

    expect(await metrics.value('auth', 'x.same')).toBe(1);
    expect(await metrics.value('catalog', 'x.same')).toBe(2);
  });

  it('la ÚNICA etiqueta es `event` — cardinalidad acotada', async () => {
    metrics.increment('orders', 'order.confirmed');
    const texto = await metrics.render();

    const lineas = texto
      .split('\n')
      .filter((l) => l.startsWith('dsm_orders_events_total{'));
    expect(lineas).toHaveLength(1);
    // Si alguien agregara una etiqueta por id de orden o de cliente, acá aparecería
    // una segunda clave y este assert falla. Es el guardián de la explosión de series.
    const etiquetas = lineas[0].match(/\{(.*?)\}/)?.[1] ?? '';
    expect(etiquetas.split(',').map((p) => p.split('=')[0])).toEqual(['event']);
  });

  it('expone métricas del proceso (CPU/memoria/event-loop) con prefijo propio', async () => {
    const texto = await metrics.render();
    expect(texto).toContain('dsm_api_process_cpu_user_seconds_total');
    expect(texto).toMatch(/dsm_api_nodejs_eventloop_lag_seconds/);
  });

  it('reset deja los contadores en cero sin perder las familias', async () => {
    metrics.increment('auth', 'auth.logout');
    expect(await metrics.value('auth', 'auth.logout')).toBe(1);

    metrics.reset();

    expect(await metrics.value('auth', 'auth.logout')).toBe(0);
    // La familia sigue declarada: la exposición no queda vacía de golpe.
    expect(await metrics.render()).toContain('dsm_auth_events_total');
  });

  it('el content-type es el formato de texto de Prometheus', () => {
    expect(metrics.contentType).toContain('text/plain');
  });
});
