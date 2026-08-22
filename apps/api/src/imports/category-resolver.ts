import { slugify } from '../common/slug';

/**
 * Lo que el resolver necesita de la persistencia. Declarado del lado del
 * consumidor para que el test pueda contar consultas con un envoltorio de tres
 * líneas y el resolver no dependa de `CategoriesRepository` entero.
 */
export interface CategorySource {
  findManyBySlugs(slugs: string[]): Promise<Map<string, string>>;
  createIfAbsent(data: {
    name: string;
    slug: string;
  }): Promise<{ id: string; created: boolean }>;
}

/**
 * T4.1 — resolución y auto-creación de categorías del import (AC-2).
 *
 * La normalización usa la **misma** `slugify()` que `CategoriesService.create`
 * (US-001): una regla, un lugar. Es lo que hace que "Plomería", "plomeria" y
 * "PLOMERÍA" sean el mismo rubro y no tres, que es exactamente el estado en el
 * que llegan los archivos reales de un proveedor.
 *
 * Se instancia **una vez por trabajo**: el cache tiene que vivir todo el import
 * para que un rubro repetido en 500 filas no genere 500 consultas.
 */
export class CategoryResolver {
  /** slug canónico → id de la categoría. */
  private readonly cache = new Map<string, string>();
  private creadas = 0;

  constructor(private readonly source: CategorySource) {}

  /** Cuántas categorías creó realmente este trabajo (contador de AC-2). */
  get categoriesCreated(): number {
    return this.creadas;
  }

  /**
   * Olvida lo que sabía de este nombre, para que la próxima fila que lo
   * referencie vuelva a resolverlo (y lo re-cree si hace falta).
   *
   * Existe por un caso concreto: si alguien borra la categoría mientras el
   * import corre, el id cacheado queda apuntando a una fila que ya no existe y
   * **todas** las filas siguientes de ese rubro fallarían por la clave foránea.
   * Una categoría borrada tiene que costar una fila, no el resto del trabajo.
   */
  invalidate(nombre: string): void {
    const slug = slugify(nombre.trim());
    if (slug !== '') this.cache.delete(slug);
  }

  /**
   * Resuelve los nombres de un lote a ids de categoría, creando las ausentes.
   *
   * @returns mapa del nombre **tal como vino en el archivo** al id. Un nombre
   * que no produce slug (`"###"`) queda **fuera** del mapa: la fila que lo
   * referencia es inválida y el llamador la reporta como `invalid_category`, en
   * vez de crear una categoría sin URL usable.
   */
  async resolve(nombres: string[]): Promise<Map<string, string>> {
    // El primer nombre visto para cada slug es el que se persiste: es cómo lo
    // escribió el dueño, con acentos y mayúsculas. Guardar el slug como nombre
    // le mostraría "plomeria" en el panel.
    const primerNombre = new Map<string, string>();
    const slugPorNombre = new Map<string, string>();

    for (const bruto of nombres) {
      const nombre = bruto.trim();
      const slug = slugify(nombre);
      if (slug === '') continue;
      slugPorNombre.set(bruto, slug);
      if (!primerNombre.has(slug)) primerNombre.set(slug, nombre);
    }

    const desconocidos = [...primerNombre.keys()].filter(
      (slug) => !this.cache.has(slug),
    );

    if (desconocidos.length > 0) {
      // Una sola consulta por lote.
      const existentes = await this.source.findManyBySlugs(desconocidos);
      existentes.forEach((id, slug) => this.cache.set(slug, id));

      for (const slug of desconocidos) {
        if (this.cache.has(slug)) continue;
        const { id, created } = await this.source.createIfAbsent({
          name: primerNombre.get(slug)!,
          slug,
        });
        this.cache.set(slug, id);
        if (created) this.creadas += 1;
      }
    }

    const resultado = new Map<string, string>();
    slugPorNombre.forEach((slug, bruto) => {
      const id = this.cache.get(slug);
      if (id !== undefined) resultado.set(bruto, id);
    });
    return resultado;
  }
}
