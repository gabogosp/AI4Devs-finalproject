import { ConfigService } from '@nestjs/config';
import { AiEmbedder } from '../ai/ports/ai.ports';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { InMemoryQueryVectorCache } from './query-vector.cache';
import { QueryEmbedder } from './query-embedder';
import { ScoredProduct } from './relevance';
import { QueryTooLongError, QueryTooShortError } from './search-errors';
import { SearchRepository } from './search.repository';
import { SearchService } from './search.service';

/**
 * T2.4 — la orquestación, con repos y embedder falsos.
 *
 * Lo que se prueba acá no es el SQL (eso son los specs de integración de T2.2/T2.3) sino las
 * **decisiones**: cuándo se degrada, cuándo se ofrece una salida, y qué NO se hace antes de
 * validar. El test que más protege plata es el último: una consulta de un carácter no puede
 * llegar al proveedor.
 */
describe('SearchService (search.service)', () => {
  const producto = (
    slug: string,
    score: number,
    category_name: string | null = 'Fijaciones',
  ): ScoredProduct => ({
    slug,
    name: `Producto ${slug}`,
    price_ars_cents: 100_000,
    stock: 3,
    image_url: null,
    category_name,
    score,
  });

  /** Repo falso: devuelve lo que cada test necesita y cuenta cómo se lo llamó. */
  class RepoFalso {
    knnCalls: Array<{ limit: number }> = [];
    fullTextCalls: string[] = [];
    constructor(
      private readonly vectoriales: ScoredProduct[] = [],
      private readonly lexicos: ScoredProduct[] = [],
      private readonly raices: string[] = ['Fijaciones', 'Herramientas', 'Plomería'],
    ) {}
    async knn(vector: number[], limit: number) {
      void vector;
      this.knnCalls.push({ limit });
      return this.vectoriales;
    }
    async fullText(q: string) {
      this.fullTextCalls.push(q);
      return this.lexicos;
    }
    async rootCategoriesByVolume() {
      return this.raices;
    }
  }

  const configCon = (extra: Record<string, unknown> = {}) =>
    new ConfigService({
      GEMINI_EMBED_MODEL: 'text-embedding-004',
      SEARCH_MIN_SCORE: 0.55,
      SEARCH_MIN_LENGTH: 2,
      SEARCH_MAX_LENGTH: 200,
      SEARCH_LIMIT_DEFAULT: 20,
      SEARCH_LIMIT_MAX: 50,
      SEARCH_LEXICAL_WEIGHT: 0,
      ...extra,
    }) as unknown as ConfigService;

  const armar = (
    repo: RepoFalso,
    embedder: AiEmbedder = new FakeAiProvider(),
    extra: Record<string, unknown> = {},
  ) => {
    const config = configCon(extra);
    const query = new QueryEmbedder(embedder, config, new InMemoryQueryVectorCache(config));
    return new SearchService(
      repo as unknown as SearchRepository,
      query,
      config,
    );
  };

  describe('camino feliz', () => {
    it('resultados sobre el umbral ⇒ high, sin fallback y sin degradar', async () => {
      const repo = new RepoFalso([producto('a', 0.91), producto('b', 0.6)]);
      const servicio = armar(repo);

      const salida = await servicio.search('algo para colgar un cuadro');

      expect(salida.confidence).toBe('high');
      expect(salida.degraded).toBe(false);
      expect(salida.fallback).toBeNull();
      expect(salida.results.map((r) => r.slug)).toEqual(['a', 'b']);
      expect(salida.interpreted_as).toBe('Buscamos en: Fijaciones');
      // Con peso léxico 0 NO se consulta el full-text: sería una query de más por resultado
      // que se descarta.
      expect(repo.fullTextCalls).toHaveLength(0);
    });

    it('la segunda búsqueda igual sale del caché y lo reporta', async () => {
      const repo = new RepoFalso([producto('a', 0.9)]);
      const fake = new FakeAiProvider();
      const servicio = armar(repo, fake);

      const primera = await servicio.search('taco fischer');
      const segunda = await servicio.search('  TACO   FISCHER ');

      expect(primera.cached).toBe(false);
      expect(segunda.cached).toBe(true);
      expect(fake.embedCalls).toHaveLength(1);
    });
  });

  describe('degradación (AC-4)', () => {
    it('un embedder que LANZA ⇒ degraded con resultados del full-text, y NO propaga', async () => {
      // Un 5xx acá convertiría un problema de un tercero en una caída de la tienda.
      const repo = new RepoFalso([], [producto('lex', 0.3)]);
      const roto: AiEmbedder = {
        available: true,
        modelVersion: 'x',
        embed: async () => {
          throw new Error('el proveedor respondió 500');
        },
      };
      const servicio = armar(repo, roto);

      const salida = await servicio.search('mecha para hormigón');

      expect(salida.degraded).toBe(true);
      expect(salida.results.map((r) => r.slug)).toEqual(['lex']);
      expect(repo.knnCalls).toHaveLength(0);
      expect(repo.fullTextCalls).toEqual(['mecha para hormigón']);
    });

    it('un embedder COLGADO ⇒ degrada al vencer el presupuesto', async () => {
      const repo = new RepoFalso([], [producto('lex', 0.4)]);
      const colgado: AiEmbedder = {
        available: true,
        modelVersion: 'x',
        embed: () => new Promise<number[]>(() => undefined),
      };
      const servicio = armar(repo, colgado, { GEMINI_SEARCH_TIMEOUT_MS: 30 });

      const salida = await servicio.search('taladro percutor');

      expect(salida.degraded).toBe(true);
      expect(salida.results).toHaveLength(1);
    });

    it('sin proveedor (sin clave o sin cuota) ⇒ degrada sin intentar la llamada', async () => {
      const repo = new RepoFalso([], [producto('lex', 0.5)]);
      const sinProveedor: AiEmbedder = {
        available: false,
        modelVersion: 'x',
        embed: jest.fn(),
      };
      const servicio = armar(repo, sinProveedor);

      const salida = await servicio.search('amoladora');

      expect(salida.degraded).toBe(true);
      expect(sinProveedor.embed).not.toHaveBeenCalled();
    });

    it('degradado y sin resultados sigue ofreciendo una salida', async () => {
      // El peor escenario combinado: sin IA y sin coincidencias léxicas. Ni así se devuelve un
      // callejón sin salida.
      const repo = new RepoFalso([], []);
      const sinProveedor: AiEmbedder = { available: false, modelVersion: 'x', embed: jest.fn() };
      const servicio = armar(repo, sinProveedor);

      const salida = await servicio.search('xyzzy que no existe');

      expect(salida.degraded).toBe(true);
      expect(salida.confidence).toBe('none');
      expect(salida.fallback!.suggested_categories.length).toBeGreaterThan(0);
    });
  });

  describe('umbral y fallback (AC-3)', () => {
    it('scores bajos ⇒ low CON fallback, y los resultados igual se devuelven', async () => {
      // No se esconden: quizás sirven. Lo que cambia es que el frontend avisa que no está
      // seguro, en vez de presentarlos como un match exacto.
      const repo = new RepoFalso([producto('a', 0.4, 'Mechas y brocas')]);
      const servicio = armar(repo);

      const salida = await servicio.search('algo raro');

      expect(salida.confidence).toBe('low');
      expect(salida.results).toHaveLength(1);
      expect(salida.fallback!.suggested_categories).toEqual(['Mechas y brocas']);
    });

    it('sin resultados ⇒ none con las categorías raíz, nunca lista vacía', async () => {
      const repo = new RepoFalso([]);
      const servicio = armar(repo);

      const salida = await servicio.search('un producto que no existe');

      expect(salida.confidence).toBe('none');
      expect(salida.results).toEqual([]);
      expect(salida.fallback!.suggested_categories).toEqual([
        'Fijaciones',
        'Herramientas',
        'Plomería',
      ]);
      expect(salida.interpreted_as).toBeNull();
    });
  });

  describe('el peso léxico es una perilla real', () => {
    it('con peso > 0 combina las dos vías', async () => {
      const repo = new RepoFalso(
        [producto('v', 0.8)],
        [producto('l', 0.9, 'Plomería')],
      );
      const servicio = armar(repo, new FakeAiProvider(), { SEARCH_LEXICAL_WEIGHT: 0.5 });

      const salida = await servicio.search('caño de media pulgada');

      expect(repo.fullTextCalls).toHaveLength(1);
      expect(salida.results.map((r) => r.slug).sort()).toEqual(['l', 'v']);
    });
  });

  describe('validación antes de gastar (AC-5)', () => {
    it('una consulta de un carácter lanza y el embedder registra CERO llamadas', async () => {
      // El test que más protege plata del módulo: la validación va antes del caché y del
      // proveedor. Si se invirtiera el orden, cada tecleo suelto costaría una llamada.
      const repo = new RepoFalso([producto('a', 0.9)]);
      const fake = new FakeAiProvider();
      const servicio = armar(repo, fake);

      await expect(servicio.search('a')).rejects.toBeInstanceOf(QueryTooShortError);

      expect(fake.embedCalls).toHaveLength(0);
      expect(repo.knnCalls).toHaveLength(0);
      expect(repo.fullTextCalls).toHaveLength(0);
    });

    it('espacios no evaden el mínimo: se mide la longitud ÚTIL', async () => {
      const fake = new FakeAiProvider();
      const servicio = armar(new RepoFalso(), fake);

      await expect(servicio.search('      a      ')).rejects.toBeInstanceOf(
        QueryTooShortError,
      );
      expect(fake.embedCalls).toHaveLength(0);
    });

    it('una consulta larguísima lanza antes de mandarla al proveedor', async () => {
      // El texto viaja al proveedor y se cobra por tamaño: un cuerpo de 50 kB en el buscador es
      // un ataque de costo con forma de consulta.
      const fake = new FakeAiProvider();
      const servicio = armar(new RepoFalso(), fake, { SEARCH_MAX_LENGTH: 20 });

      await expect(servicio.search('x'.repeat(500))).rejects.toBeInstanceOf(
        QueryTooLongError,
      );
      expect(fake.embedCalls).toHaveLength(0);
    });

    it('el error dice el mínimo con número, para que el cliente no adivine', async () => {
      const servicio = armar(new RepoFalso(), new FakeAiProvider(), { SEARCH_MIN_LENGTH: 3 });

      const error = await servicio.search('ab').catch((e: QueryTooShortError) => e);

      expect(error).toBeInstanceOf(QueryTooShortError);
      expect((error as QueryTooShortError).status).toBe(422);
      expect((error as QueryTooShortError).type).toBe('dsm:search/query-too-short');
      expect((error as QueryTooShortError).message).toContain('3');
    });
  });

  describe('el limit', () => {
    it('sin pedido usa el default', async () => {
      const repo = new RepoFalso([producto('a', 0.9)]);
      await armar(repo).search('taco fischer');
      expect(repo.knnCalls[0].limit).toBe(20);
    });

    it('un pedido desmedido se acota al tope en vez de fallar', async () => {
      const repo = new RepoFalso([producto('a', 0.9)]);
      await armar(repo).search('taco fischer', 5_000);
      expect(repo.knnCalls[0].limit).toBe(50);
    });

    it('un pedido de 0 o negativo se lleva a 1', async () => {
      const repo = new RepoFalso([producto('a', 0.9)]);
      await armar(repo).search('taco fischer', 0);
      expect(repo.knnCalls[0].limit).toBe(1);
    });
  });
});
