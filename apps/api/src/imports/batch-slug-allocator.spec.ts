import { BatchSlugAllocator, SlugPrefixSource } from './batch-slug-allocator';

/**
 * T2.2 — lo que se prueba acá no es "devuelve un slug": es **cuántas veces va a
 * la base**. El N+1 y la colisión intra-lote son los dos defectos que este
 * objeto existe para evitar, y los dos son invisibles en un test de resultado.
 */
class RepoEspia implements SlugPrefixSource {
  llamadas: string[][] = [];

  constructor(private readonly existentes: string[] = []) {}

  async findSlugsByPrefixes(bases: string[]): Promise<string[]> {
    this.llamadas.push([...bases]);
    return this.existentes.filter((slug) =>
      bases.some((b) => slug.startsWith(b)),
    );
  }
}

describe('BatchSlugAllocator', () => {
  it('prime de 200 bases hace UNA sola consulta', async () => {
    const repo = new RepoEspia();
    const allocator = new BatchSlugAllocator(repo);
    const bases = Array.from({ length: 200 }, (_, i) => `producto-${i}`);

    await allocator.prime(bases);

    expect(repo.llamadas).toHaveLength(1);
    expect(repo.llamadas[0]).toHaveLength(200);
  });

  it('dos filas del mismo lote con el mismo nombre no colisionan, sin consultar de nuevo', async () => {
    const repo = new RepoEspia();
    const allocator = new BatchSlugAllocator(repo);
    await allocator.prime(['heladera']);
    repo.llamadas = [];

    expect([allocator.allocate('heladera'), allocator.allocate('heladera')]).toEqual([
      'heladera',
      'heladera-2',
    ]);
    // Cero consultas adicionales: el set acumulador es el que desambigua.
    expect(repo.llamadas).toHaveLength(0);
  });

  it('respeta lo que ya está en la base', async () => {
    const repo = new RepoEspia(['heladera']);
    const allocator = new BatchSlugAllocator(repo);
    await allocator.prime(['heladera']);

    expect([allocator.allocate('heladera'), allocator.allocate('heladera')]).toEqual([
      'heladera-2',
      'heladera-3',
    ]);
  });

  it('el set acumulador sobrevive entre lotes: 400 filas en lotes de 200 son 2 consultas', async () => {
    const repo = new RepoEspia();
    const allocator = new BatchSlugAllocator(repo);

    const lote1 = Array.from({ length: 200 }, (_, i) => `p-${i}`);
    const lote2 = Array.from({ length: 200 }, (_, i) => `p-${200 + i}`);

    await allocator.prime(lote1);
    lote1.forEach((b) => allocator.allocate(b));
    await allocator.prime(lote2);
    lote2.forEach((b) => allocator.allocate(b));

    // 2, no 400: es el criterio de cierre de la task.
    expect(repo.llamadas).toHaveLength(2);
    expect(allocator.size).toBe(400);
  });

  it('un nombre repetido en dos lotes distintos tampoco colisiona', async () => {
    const repo = new RepoEspia();
    const allocator = new BatchSlugAllocator(repo);

    await allocator.prime(['heladera']);
    const primero = allocator.allocate('heladera');
    // Segundo lote: la base `heladera` ya fue cebada, así que no se re-consulta.
    await allocator.prime(['heladera']);
    const segundo = allocator.allocate('heladera');

    expect([primero, segundo]).toEqual(['heladera', 'heladera-2']);
    expect(repo.llamadas).toHaveLength(1);
  });

  it('no consulta cuando el lote no trae bases nuevas', async () => {
    const repo = new RepoEspia();
    const allocator = new BatchSlugAllocator(repo);
    await allocator.prime([]);
    expect(repo.llamadas).toHaveLength(0);
  });

  it('deduplica las bases del lote antes de consultar', async () => {
    const repo = new RepoEspia();
    const allocator = new BatchSlugAllocator(repo);
    await allocator.prime(['heladera', 'heladera', 'mecha']);
    expect(repo.llamadas[0]).toEqual(['heladera', 'mecha']);
  });
});
