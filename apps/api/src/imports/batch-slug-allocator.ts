import { resolveSlug } from '../common/slug';

/**
 * Lo único que el allocator necesita de la persistencia. Se declara acá, del
 * lado del consumidor, para que el allocator no dependa de `ProductsRepository`
 * entero (ni de Prisma) y el test pueda espiar las consultas con tres líneas.
 */
export interface SlugPrefixSource {
  findSlugsByPrefixes(bases: string[]): Promise<string[]>;
}

/**
 * T2.2 — asignador de slugs por lote.
 *
 * Resuelve los dos problemas que `ProductsService.deriveUniqueSlug` tiene cuando
 * el volumen deja de ser "de a uno":
 *
 * 1. **N+1**: una query de slugs por fila son 5.000 idas a la base en un import
 *    al tope. `prime()` trae los slugs de todo el lote en **una**.
 * 2. **Colisión intra-lote**: dos filas del mismo archivo con el mismo nombre
 *    calculan las dos `heladera` y la segunda revienta el UNIQUE. El slug
 *    asignado se agrega al set en el acto, así la segunda ve `heladera` ocupada
 *    y se lleva `heladera-2` sin consultar nada.
 *
 * El set vive todo el trabajo (no se reinicia por lote): un nombre repetido en
 * el lote 1 y en el lote 20 tampoco puede colisionar.
 *
 * La **base sigue siendo la autoridad**: el allocator es una optimización, no
 * una garantía. Si dos procesos importaran a la vez, el UNIQUE de `products.slug`
 * es el que decide y la fila perdedora vuelve al reporte como `slug_conflict`
 * (T4.2).
 */
export class BatchSlugAllocator {
  private readonly taken = new Set<string>();
  private readonly cebadas = new Set<string>();

  constructor(private readonly source: SlugPrefixSource) {}

  /**
   * Trae de la base los slugs tomados que empiezan con cualquiera de estas
   * bases. Las bases ya cebadas en un lote anterior no se vuelven a consultar.
   */
  async prime(bases: string[]): Promise<void> {
    const nuevas = [...new Set(bases)].filter((b) => !this.cebadas.has(b));
    if (nuevas.length === 0) return;
    const slugs = await this.source.findSlugsByPrefixes(nuevas);
    slugs.forEach((s) => this.taken.add(s));
    nuevas.forEach((b) => this.cebadas.add(b));
  }

  /**
   * Devuelve un slug libre para `base` y lo marca como tomado. Síncrono a
   * propósito: si necesitara ir a la base, volveríamos al N+1 que vino a evitar.
   */
  allocate(base: string): string {
    const slug = resolveSlug(base, this.taken);
    this.taken.add(slug);
    return slug;
  }

  /**
   * Vuelve a consultar la base para estas bases, aunque ya estuvieran cebadas.
   *
   * Existe para **un** caso: el reintento tras una colisión real de `slug`
   * (T4.2). Si la base tiene un slug que el allocator no vio —porque lo escribió
   * otro proceso—, re-cebar es lo único que puede darle una propuesta distinta;
   * reintentar con el mismo set sería repetir el error.
   */
  async refresh(bases: string[]): Promise<void> {
    const unicas = [...new Set(bases)];
    if (unicas.length === 0) return;
    const slugs = await this.source.findSlugsByPrefixes(unicas);
    slugs.forEach((s) => this.taken.add(s));
    unicas.forEach((b) => this.cebadas.add(b));
  }

  /** Sólo para diagnóstico y tests: cuántos slugs conoce. */
  get size(): number {
    return this.taken.size;
  }
}
