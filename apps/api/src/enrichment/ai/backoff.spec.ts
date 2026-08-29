import {
  AiPermanentError,
  AiTransientError,
} from '../../common/errors/enrichment-errors';
import { backoffDelayMs, withRetry } from './backoff';
import { RateLimiter } from './rate-limiter';

/**
 * T1.3 — reintentos y limitador. **Ningún test duerme**: el `sleep` se inyecta y sólo
 * acumula el tiempo simulado, así que la suite entera corre en milisegundos de reloj real
 * aunque simule minutos de espera.
 */

/** `sleep` de test: no espera, sólo lleva la cuenta del tiempo simulado. */
function relojSimulado() {
  let ahora = 0;
  const esperas: number[] = [];
  return {
    now: () => ahora,
    esperas,
    sleep: async (ms: number) => {
      esperas.push(ms);
      ahora += ms;
    },
    get transcurrido() {
      return ahora;
    },
  };
}

describe('backoffDelayMs', () => {
  const opts = { baseMs: 1_000, capMs: 30_000, random: () => 0.5 };

  it('crece exponencialmente: 1s, 2s, 4s, 8s (con jitter fijo al 75%)', () => {
    // random()=0.5 ⇒ factor 0.5 + 0.25 = 0.75, así el crecimiento es observable.
    expect(backoffDelayMs(0, opts)).toBe(750);
    expect(backoffDelayMs(1, opts)).toBe(1_500);
    expect(backoffDelayMs(2, opts)).toBe(3_000);
    expect(backoffDelayMs(3, opts)).toBe(6_000);
  });

  it('respeta el techo: no crece indefinidamente', () => {
    expect(backoffDelayMs(20, opts)).toBe(22_500); // 30_000 × 0.75
  });

  it('el jitter mantiene la espera dentro de [50%, 100%) del backoff', () => {
    // Sin jitter, N corridas que fallan juntas reintentan juntas y repiten la ráfaga
    // que tiró al proveedor.
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const d = backoffDelayMs(2, { baseMs: 1_000, capMs: 30_000, random: () => r });
      expect(d).toBeGreaterThanOrEqual(2_000); // 4_000 × 0.5
      expect(d).toBeLessThan(4_000);
    }
  });

  it('dos llamadas con random real dan esperas distintas (hay jitter de verdad)', () => {
    const muestras = new Set(
      Array.from({ length: 20 }, () =>
        backoffDelayMs(3, { baseMs: 1_000, capMs: 30_000 }),
      ),
    );
    expect(muestras.size).toBeGreaterThan(1);
  });
});

describe('withRetry', () => {
  const base = (reloj: ReturnType<typeof relojSimulado>) => ({
    baseMs: 1_000,
    capMs: 30_000,
    maxRetries: 3,
    random: () => 0.5,
    sleep: reloj.sleep,
  });

  it('un transitorio persistente ⇒ 4 invocaciones (1 + 3 reintentos)', async () => {
    const reloj = relojSimulado();
    const fn = jest.fn().mockRejectedValue(new AiTransientError('503'));

    await expect(withRetry(fn, base(reloj))).rejects.toBeInstanceOf(AiTransientError);

    expect(fn).toHaveBeenCalledTimes(4);
    expect(reloj.esperas).toHaveLength(3);
  });

  it('las esperas son monótonas crecientes', async () => {
    const reloj = relojSimulado();
    const fn = jest.fn().mockRejectedValue(new AiTransientError('503'));

    await withRetry(fn, base(reloj)).catch(() => undefined);

    expect(reloj.esperas).toEqual([750, 1_500, 3_000]);
  });

  it('un transitorio que después funciona ⇒ devuelve el resultado', async () => {
    const reloj = relojSimulado();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new AiTransientError('429'))
      .mockResolvedValue('ok');

    await expect(withRetry(fn, base(reloj))).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retryAfterSeconds del proveedor GANA sobre el backoff calculado', async () => {
    // El proveedor sabe mejor que nuestra fórmula cuándo va a volver a atender;
    // esperar 750 ms porque el backoff lo dice es pedirle otro 429.
    const reloj = relojSimulado();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new AiTransientError('429', 30))
      .mockResolvedValue('ok');

    await withRetry(fn, base(reloj));

    expect(reloj.esperas).toEqual([30_000]);
  });

  it('un AiPermanentError NO se reintenta: 1 sola invocación', async () => {
    // Cinco intentos contra un vector de 512 dimensiones queman cuota para nada.
    const reloj = relojSimulado();
    const fn = jest.fn().mockRejectedValue(new AiPermanentError('512 dims'));

    await expect(withRetry(fn, base(reloj))).rejects.toBeInstanceOf(AiPermanentError);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(reloj.esperas).toHaveLength(0);
  });

  it('un error que no es de IA tampoco se reintenta', async () => {
    const reloj = relojSimulado();
    const fn = jest.fn().mockRejectedValue(new TypeError('bug nuestro'));

    await expect(withRetry(fn, base(reloj))).rejects.toBeInstanceOf(TypeError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('RateLimiter', () => {
  it('con 15 RPM el intervalo mínimo es 4000 ms', () => {
    expect(new RateLimiter({ maxRpm: 15 }).minIntervalMs).toBe(4_000);
  });

  it('dos llamadas consecutivas salen separadas por el intervalo mínimo', async () => {
    const reloj = relojSimulado();
    const limiter = new RateLimiter({ maxRpm: 15, now: reloj.now, sleep: reloj.sleep });
    const salidas: number[] = [];

    await limiter.schedule(async () => salidas.push(reloj.now()));
    await limiter.schedule(async () => salidas.push(reloj.now()));

    expect(salidas[1] - salidas[0]).toBeGreaterThanOrEqual(4_000);
  });

  it('30 llamadas a 15 RPM ocupan ≥ 116 s de reloj SIMULADO', async () => {
    const reloj = relojSimulado();
    const limiter = new RateLimiter({ maxRpm: 15, now: reloj.now, sleep: reloj.sleep });

    const arranque = Date.now();
    for (let i = 0; i < 30; i += 1) {
      await limiter.schedule(async () => i);
    }

    // 29 intervalos × 4 s = 116 s simulados…
    expect(reloj.transcurrido).toBeGreaterThanOrEqual(116_000);
    // …y el test termina en milisegundos de reloj REAL: no durmió de verdad.
    expect(Date.now() - arranque).toBeLessThan(5_000);
  });

  it('llamadas disparadas en paralelo reservan huecos distintos', async () => {
    // El bug clásico de un limitador que sólo mira Date.now(): dos llamadas
    // simultáneas ven el mismo hueco libre y salen juntas.
    const reloj = relojSimulado();
    const limiter = new RateLimiter({ maxRpm: 15, now: reloj.now, sleep: reloj.sleep });
    const salidas: number[] = [];

    await Promise.all([
      limiter.schedule(async () => salidas.push(reloj.now())),
      limiter.schedule(async () => salidas.push(reloj.now())),
      limiter.schedule(async () => salidas.push(reloj.now())),
    ]);

    const ordenadas = [...salidas].sort((a, b) => a - b);
    expect(ordenadas[1] - ordenadas[0]).toBeGreaterThanOrEqual(4_000);
    expect(ordenadas[2] - ordenadas[1]).toBeGreaterThanOrEqual(4_000);
  });

  it('un fallo de la llamada no bloquea la cola', async () => {
    const reloj = relojSimulado();
    const limiter = new RateLimiter({ maxRpm: 60, now: reloj.now, sleep: reloj.sleep });

    await expect(
      limiter.schedule(async () => {
        throw new AiTransientError('503');
      }),
    ).rejects.toBeInstanceOf(AiTransientError);

    await expect(limiter.schedule(async () => 'sigue andando')).resolves.toBe(
      'sigue andando',
    );
  });
});
