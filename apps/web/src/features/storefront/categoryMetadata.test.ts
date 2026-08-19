import { describe, expect, it } from 'vitest';
import { buildBreadcrumbJsonLd, categoryMetadata, categoryUrl } from './categoryMetadata';
import { serializeJsonLd } from './ProductJsonLd';
import type { StorefrontCategory } from './categoriesStorefrontService';

function category(over: Partial<StorefrontCategory> = {}): StorefrontCategory {
  return {
    slug: 'climatizacion',
    name: 'Climatización',
    parent: null,
    children: [],
    ...over,
  } as StorefrontCategory;
}

describe('categoryMetadata (AC-4)', () => {
  it('página 1: title con el nombre y canonical sin ?page', () => {
    const meta = categoryMetadata(category(), 1);

    expect(meta.title).toContain('Climatización');
    expect(meta.title).not.toContain('Página');
    expect(meta.alternates?.canonical).toBe(categoryUrl('climatizacion'));
    expect(String(meta.alternates?.canonical)).not.toContain('?page=');
  });

  it('página N: canonical AUTO-referencial, no apuntando a la página 1', () => {
    const meta = categoryMetadata(category(), 3);

    // Canonicalizar todo hacia la página 1 des-indexaría los productos de la
    // página 2 en adelante, que son la mayoría del catálogo.
    expect(String(meta.alternates?.canonical)).toContain('?page=3');
    expect(meta.title).toContain('Página 3');
  });

  it('ninguna página lleva noindex', () => {
    expect(categoryMetadata(category(), 1).robots).toBeUndefined();
    expect(categoryMetadata(category(), 5).robots).toBeUndefined();
  });

  it('categoría inexistente: metadatos mínimos en vez de explotar', () => {
    const meta = categoryMetadata(null, 1);

    expect(meta.title).toContain('no encontrada');
    expect(meta.alternates?.canonical).toBeUndefined();
  });
});

describe('buildBreadcrumbJsonLd (AC-4)', () => {
  it('rubro raíz: Inicio › rubro', () => {
    const ld = buildBreadcrumbJsonLd(category());

    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement).toHaveLength(2);
    expect(ld.itemListElement[1].name).toBe('Climatización');
    expect(ld.itemListElement[1].position).toBe(2);
  });

  it('subrubro: incluye el rubro padre en el medio', () => {
    const ld = buildBreadcrumbJsonLd(
      category({
        slug: 'compresores',
        name: 'Compresores',
        parent: { slug: 'climatizacion', name: 'Climatización' },
      }),
    );

    expect(ld.itemListElement.map((i) => i.name)).toEqual([
      'Inicio',
      'Climatización',
      'Compresores',
    ]);
  });

  it('un nombre con </script> no rompe el documento (input del dueño)', () => {
    const ld = buildBreadcrumbJsonLd(
      category({ name: 'Climatización</script><script>alert(1)</script>' }),
    );

    const html = serializeJsonLd(ld);

    // Sin el escape de `<`, la secuencia cerraría la etiqueta y todo lo que
    // sigue se interpretaría como HTML.
    expect(html).not.toContain('</script>');
    expect(html).toContain('\\u003c');
    expect(() => JSON.parse(html)).not.toThrow();
  });
});
