import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { configNumber } from '../enrichment/config-number';
import { normalizeQuery } from './normalize-query';

/**
 * Puerto del caché de vectores de consulta (US-004 T1.3).
 *
 * Es un puerto y no una clase concreta porque el reemplazo está previsto: cuando US-019
 * provisione Redis, entra un adapter por este mismo token y el servicio de búsqueda no se
 * toca. Es la tercera instancia del patrón «almacén en proceso mientras Redis no exista»
 * (ADR-0012, ADR-0014) y no lleva ADR propio: acá no hay durabilidad en juego, sólo costo.
 */
export const QUERY_VECTOR_CACHE = Symbol('QUERY_VECTOR_CACHE');

export interface QueryVectorCache {
  get(consulta: string, model: string): number[] | undefined;
  set(consulta: string, model: string, vector: number[]): void;
  /** Entradas vivas. Para el `/status` y para los tests del LRU. */
  readonly size: number;
}

interface Entrada {
  vector: number[];
  /** Instante de escritura, para el TTL. */
  guardadoEn: number;
}

/**
 * Caché LRU **del vector**, no de los resultados.
 *
 * La distinción es la decisión de diseño más importante de este archivo (D6). Cachear los
 * **resultados** haría que un cambio de precio o de stock tarde hasta 24 h en verse: el mismo
 * defecto que US-007 evitó recalculando el carrito en cada lectura. Cachear el **vector**
 * ahorra la llamada paga —que es el recurso escaso— y deja que el kNN y la hidratación corran
 * siempre frescos. El kNN cuesta ~30 ms; no hace falta cachearlo.
 *
 * **Con el free tier esto no es una optimización: es lo único que hace tolerable el techo.**
 * De ahí el TTL de 24 h, que no es agresividad sino aritmética: el vector de una consulta es
 * determinista (`embedding = f(texto, modelo)`), así que no hay dato que pueda quedar viejo
 * mientras el modelo no cambie. Y como la clave **incluye el modelo**, cambiarlo invalida todo
 * naturalmente. Lo que acota el caché es el **LRU por tamaño**, no el tiempo: un TTL corto sólo
 * tiraría trabajo ya pagado.
 */
@Injectable()
export class InMemoryQueryVectorCache implements QueryVectorCache {
  /**
   * `Map` y no un objeto: el `Map` de JS **preserva el orden de inserción**, y eso alcanza
   * para un LRU exacto sin estructura adicional — al leer se borra y se re-inserta la entrada,
   * así la más vieja siempre es la primera del iterador.
   */
  private readonly entradas = new Map<string, Entrada>();

  constructor(
    private readonly config: ConfigService,
    /** Inyectable para tests: permite avanzar el reloj sin esperar 24 h. */
    @Optional() @Inject('QUERY_CACHE_NOW') private readonly now: () => number = () => Date.now(),
  ) {}

  get size(): number {
    return this.entradas.size;
  }

  private clave(consulta: string, model: string): string {
    // El modelo va PRIMERO y forma parte de la clave: el vector sólo es determinista para un
    // modelo dado. Sin esto, un cambio de `GEMINI_EMBED_MODEL` serviría vectores del modelo
    // viejo contra un índice HNSW poblado con el nuevo, y el síntoma sería «la búsqueda
    // empeoró» sin ningún error a la vista.
    return `${model}:${normalizeQuery(consulta)}`;
  }

  get(consulta: string, model: string): number[] | undefined {
    const k = this.clave(consulta, model);
    const entrada = this.entradas.get(k);
    if (!entrada) return undefined;

    const ttl = configNumber(this.config, 'SEARCH_CACHE_TTL_MS', 86_400_000);
    if (this.now() - entrada.guardadoEn >= ttl) {
      this.entradas.delete(k);
      return undefined;
    }

    // Re-inserción: la vuelve la más reciente para el LRU.
    this.entradas.delete(k);
    this.entradas.set(k, entrada);
    return entrada.vector;
  }

  set(consulta: string, model: string, vector: number[]): void {
    const k = this.clave(consulta, model);
    this.entradas.delete(k);
    this.entradas.set(k, { vector, guardadoEn: this.now() });

    const tope = configNumber(this.config, 'SEARCH_CACHE_MAX_ENTRIES', 2_000);
    // Se evicta de a uno desde el frente (el menos usado recientemente). Un caché en proceso
    // sin tope es una fuga de memoria con nombre elegante: 200 caracteres por consulta y 768
    // floats por vector se acumulan hasta que el proceso muere.
    while (this.entradas.size > tope) {
      const masViejo = this.entradas.keys().next();
      if (masViejo.done) break;
      this.entradas.delete(masViejo.value);
    }
  }
}
