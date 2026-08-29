import { ConfigService } from '@nestjs/config';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { EnrichmentRepository } from '../enrichment/enrichment.repository';
import { PrismaService } from '../prisma/prisma.service';
import { InMemoryQueryVectorCache } from './query-vector.cache';
import { QueryEmbedder } from './query-embedder';

/**
 * T1.3 — el caché de vectores de consulta.
 *
 * Con el free tier (10 RPM para la búsqueda) este caché **no es una optimización**: es lo único
 * que hace tolerable el techo. Una consulta repetida que vuelva a pagar es una ranura menos para
 * el próximo cliente.
 *
 * El test que explica el diseño es el último: se cachea **el vector** y no los resultados, así
 * que un cambio de stock se ve en la búsqueda siguiente. Cachear resultados habría hecho que un
 * producto agotado siga apareciendo como disponible hasta 24 h — el mismo defecto que US-007
 * evitó recalculando el carrito en cada lectura.
 */
describe('Caché de vectores de consulta (query-vector.cache)', () => {
  const configCon = (extra: Record<string, unknown> = {}) =>
    new ConfigService({
      GEMINI_EMBED_MODEL: 'text-embedding-004',
      SEARCH_CACHE_TTL_MS: 86_400_000,
      SEARCH_CACHE_MAX_ENTRIES: 2_000,
      ...extra,
    }) as unknown as ConfigService;

  describe('ahorro de llamadas', () => {
    it('«Taco  Fischer» y «taco fischer» son UNA sola llamada al proveedor', async () => {
      // Espaciado y mayúsculas no cambian el pedido. Si cada variante costara su llamada, dos
      // clientes escribiendo lo mismo con otra capitalización gastarían el doble de cuota.
      const fake = new FakeAiProvider();
      const config = configCon();
      const buscador = new QueryEmbedder(fake, config, new InMemoryQueryVectorCache(config));

      const primera = await buscador.embedQuery('Taco  Fischer');
      const segunda = await buscador.embedQuery('taco fischer');
      const tercera = await buscador.embedQuery('  TACO   FISCHER  ');

      expect(fake.embedCalls).toHaveLength(1);
      expect(primera.ok && primera.cached).toBe(false);
      expect(segunda.ok && segunda.cached).toBe(true);
      expect(tercera.ok && tercera.cached).toBe(true);
      // Y el vector servido es el mismo, no uno parecido.
      if (primera.ok && segunda.ok) {
        expect(segunda.vector).toEqual(primera.vector);
      }
    });

    it('consultas distintas sí pagan su llamada', async () => {
      // Contraste obligatorio: sin él, un caché que devuelva siempre lo mismo pasaría el test
      // anterior y estaría roto.
      const fake = new FakeAiProvider();
      const config = configCon();
      const buscador = new QueryEmbedder(fake, config, new InMemoryQueryVectorCache(config));

      await buscador.embedQuery('taco fischer');
      await buscador.embedQuery('mecha widia');

      expect(fake.embedCalls).toHaveLength(2);
    });

    it('un vector ya pagado se sirve aunque el proveedor haya quedado sin cuota', async () => {
      // El orden importa: el caché se consulta ANTES de mirar la disponibilidad. Degradar a
      // full-text teniendo el vector en la mano sería regalar trabajo ya comprado justo cuando
      // el recurso escasea.
      const config = configCon();
      const cache = new InMemoryQueryVectorCache(config);
      const fake = new FakeAiProvider();
      await new QueryEmbedder(fake, config, cache).embedQuery('taco fischer');

      const sinCuota = { available: false, modelVersion: 'x', embed: jest.fn() };
      const resultado = await new QueryEmbedder(sinCuota, config, cache).embedQuery(
        'taco fischer',
      );

      expect(resultado.ok).toBe(true);
      expect(sinCuota.embed).not.toHaveBeenCalled();
    });
  });

  describe('la clave incluye el modelo', () => {
    it('cambiar GEMINI_EMBED_MODEL invalida la entrada', async () => {
      // El vector es determinista **para un modelo dado**. Sin el modelo en la clave, un cambio
      // de `GEMINI_EMBED_MODEL` serviría vectores del modelo viejo contra un índice poblado con
      // el nuevo: el síntoma sería «la búsqueda empeoró», sin ningún error a la vista.
      const cache = new InMemoryQueryVectorCache(configCon());
      const fake = new FakeAiProvider();

      const viejo = configCon({ GEMINI_EMBED_MODEL: 'text-embedding-004' });
      await new QueryEmbedder(fake, viejo, cache).embedQuery('taco fischer');
      expect(fake.embedCalls).toHaveLength(1);

      const nuevo = configCon({ GEMINI_EMBED_MODEL: 'text-embedding-005' });
      const resultado = await new QueryEmbedder(fake, nuevo, cache).embedQuery('taco fischer');

      expect(fake.embedCalls).toHaveLength(2);
      expect(resultado.ok && resultado.cached).toBe(false);
      expect(resultado.ok && resultado.model).toBe('text-embedding-005');
    });
  });

  describe('el TTL y el tope', () => {
    it('pasado el TTL, la misma consulta vuelve a llamar', () => {
      let reloj = 0;
      const config = configCon({ SEARCH_CACHE_TTL_MS: 1_000 });
      const cache = new InMemoryQueryVectorCache(config, () => reloj);

      cache.set('taco fischer', 'm1', [0.1, 0.2]);
      expect(cache.get('taco fischer', 'm1')).toEqual([0.1, 0.2]);

      reloj = 1_000;
      expect(cache.get('taco fischer', 'm1')).toBeUndefined();
      // Y la entrada vencida no queda ocupando lugar.
      expect(cache.size).toBe(0);
    });

    it('con 2.001 consultas distintas, el tamaño queda en 2.000', () => {
      // Un caché en proceso sin tope es una fuga de memoria con nombre elegante: 768 floats por
      // vector se acumulan hasta que el proceso muere.
      const config = configCon({ SEARCH_CACHE_MAX_ENTRIES: 2_000 });
      const cache = new InMemoryQueryVectorCache(config);

      for (let i = 0; i < 2_001; i += 1) cache.set(`consulta ${i}`, 'm1', [i]);

      expect(cache.size).toBe(2_000);
      // Se evictó el MENOS usado recientemente, que es el primero que entró.
      expect(cache.get('consulta 0', 'm1')).toBeUndefined();
      expect(cache.get('consulta 2000', 'm1')).toEqual([2_000]);
    });

    it('LRU de verdad: leer una entrada la salva de la evicción', () => {
      // Si fuera FIFO en vez de LRU, la consulta más popular del sitio se evictaría por
      // antigüedad justo por ser la primera que alguien buscó.
      const config = configCon({ SEARCH_CACHE_MAX_ENTRIES: 3 });
      const cache = new InMemoryQueryVectorCache(config);

      cache.set('a', 'm1', [1]);
      cache.set('b', 'm1', [2]);
      cache.set('c', 'm1', [3]);
      // Se usa `a`: pasa a ser la más reciente.
      expect(cache.get('a', 'm1')).toEqual([1]);

      cache.set('d', 'm1', [4]); // fuerza una evicción

      expect(cache.get('a', 'm1')).toEqual([1]); // sobrevivió por haberse usado
      expect(cache.get('b', 'm1')).toBeUndefined(); // la víctima es la menos usada
      expect(cache.size).toBe(3);
    });
  });

  describe('se cachea el VECTOR, no los resultados', () => {
    const prisma = new PrismaService();
    const corrida = idDeCorrida();

    beforeAll(async () => {
      await prisma.$connect();
    });
    afterAll(async () => {
      await prisma.$disconnect();
    });

    it('un cambio de stock se ve en la búsqueda SIGUIENTE, sin esperar el TTL', async () => {
      // El test que justifica la decisión de diseño. Con los resultados cacheados 24 h, un
      // producto agotado seguiría ofreciéndose como disponible hasta el día siguiente.
      const config = configCon();
      const cache = new InMemoryQueryVectorCache(config);
      const fake = new FakeAiProvider();
      const buscador = new QueryEmbedder(fake, config, cache);
      const repo = new EnrichmentRepository(prisma, config);

      const categoryId = await asegurarCategoria(
        prisma,
        `cache-${corrida}`,
        `Cache ${corrida}`,
      );
      const clave = `CACHE-${corrida}`;
      const producto = await prisma.product.create({
        data: {
          sku: clave,
          slug: clave.toLowerCase(),
          name: 'Amoladora angular',
          price_ars_cents: 150_000,
          stock: 7,
          status: 'published',
          category_id: categoryId,
        },
      });

      // Se le da al producto el vector de la consulta, así el kNN lo devuelve primero.
      const consulta = `amoladora ${corrida}`;
      const primera = await buscador.embedQuery(consulta);
      expect(primera.ok).toBe(true);
      if (!primera.ok) return;
      await repo.saveEmbedding(producto.id, primera.vector, fake.modelVersion);

      /** Búsqueda completa: vector (cacheado o no) → kNN → lectura FRESCA del stock. */
      const buscar = async () => {
        const emb = await buscador.embedQuery(consulta);
        expect(emb.ok).toBe(true);
        if (!emb.ok) throw new Error('sin vector');
        const vecinos = await repo.findNearest(emb.vector, 5);
        const filas = await prisma.$queryRawUnsafe<Array<{ slug: string; stock: number }>>(
          `SELECT slug, stock FROM products WHERE id = $1::uuid`,
          producto.id,
        );
        return { cached: emb.cached, top: vecinos[0]?.id, stock: filas[0]?.stock };
      };

      const antes = await buscar();
      expect(antes.top).toBe(producto.id);
      expect(antes.stock).toBe(7);

      // Se agota el producto por fuera de la aplicación.
      await prisma.$executeRawUnsafe(
        `UPDATE products SET stock = 0 WHERE id = $1::uuid`,
        producto.id,
      );

      const despues = await buscar();

      // El vector vino del caché (no se pagó otra llamada)…
      expect(despues.cached).toBe(true);
      expect(fake.embedCalls).toHaveLength(1);
      // …y sin embargo el stock es el nuevo. Eso es lo que se buscaba.
      expect(despues.stock).toBe(0);
    });

    it('lo que guarda el caché es un vector y nada más', async () => {
      // Verificación estructural del invariante: si algún día alguien guardara el producto
      // hidratado «para ahorrar el JOIN», el test anterior seguiría pasando por un rato y el
      // defecto aparecería como precios viejos en producción.
      const config = configCon();
      const cache = new InMemoryQueryVectorCache(config);
      cache.set('taco fischer', 'm1', [0.1, 0.2, 0.3]);

      const guardado = cache.get('taco fischer', 'm1');

      expect(Array.isArray(guardado)).toBe(true);
      expect(guardado!.every((n) => typeof n === 'number')).toBe(true);
    });
  });
});
