/**
 * Limitador de RPM del proveedor (US-005 T1.3) — `backend-node-standards.md` §8:
 * respetar el rate-limit del proveedor **antes** de que él nos lo recuerde con un 429.
 *
 * Serializa las salidas garantizando un intervalo mínimo de `60_000 / maxRpm` ms entre
 * dos llamadas. No es un token bucket: para el free tier (15 RPM) el espaciado uniforme
 * es más simple y más amable con la cuota que una ráfaga de 15 seguida de 55 s de silencio.
 *
 * El reloj y el `sleep` se **inyectan**: el test verifica el espaciado con fake timers y
 * termina en milisegundos de reloj real, en vez de esperar dos minutos.
 */
export interface RateLimiterOptions {
  maxRpm: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimiter {
  private readonly intervaloMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Instante en que puede salir la próxima llamada. */
  private siguienteHueco = 0;
  /** Cola implícita: cada llamada espera a que la anterior haya reservado su hueco. */
  private cadena: Promise<void> = Promise.resolve();

  constructor({ maxRpm, now, sleep }: RateLimiterOptions) {
    this.intervaloMs = Math.ceil(60_000 / maxRpm);
    this.now = now ?? (() => Date.now());
    this.sleep =
      sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  }

  /** Intervalo mínimo entre dos salidas, en ms. */
  get minIntervalMs(): number {
    return this.intervaloMs;
  }

  /**
   * Espera lo necesario y ejecuta `fn`.
   *
   * La reserva del hueco se hace **en la cadena** (no en paralelo): dos llamadas
   * disparadas a la vez reservan huecos distintos en vez de pelear por el mismo, que es
   * el bug clásico de un limitador que sólo mira `Date.now()`.
   */
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const miTurno = this.cadena.then(async () => {
      const ahora = this.now();
      const espera = Math.max(0, this.siguienteHueco - ahora);
      // El próximo hueco se calcula desde el momento en que sale ESTA llamada, así el
      // espaciado se mantiene aunque el proceso haya estado ocioso.
      this.siguienteHueco = Math.max(ahora, this.siguienteHueco) + this.intervaloMs;
      if (espera > 0) await this.sleep(espera);
    });
    this.cadena = miTurno.catch(() => undefined);

    await miTurno;
    return fn();
  }
}
