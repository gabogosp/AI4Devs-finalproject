// El query DTO usa decoradores (@Type/@IsInt); fuera del contenedor de Nest hay
// que cargar el polyfill de metadata a mano.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Category } from '@dsm/db';
import {
  ListStorefrontProductsQueryDto,
  StorefrontCategoryDto,
} from './storefront-category.dto';

/** Unit del DTO de categoría y del query de paginación (US-002 T3.1). */
describe('DTOs públicos de navegación por categorías', () => {
  const cat = (over: Partial<Category> = {}): Category => ({
    id: 'cat-1',
    slug: 'refrigeracion',
    name: 'Refrigeración',
    parent_id: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...over,
  });

  describe('StorefrontCategoryDto', () => {
    it('expone exactamente slug, name, parent y children', () => {
      const dto = StorefrontCategoryDto.from({
        ...cat({ slug: 'compresores', name: 'Compresores', parent_id: 'cat-0' }),
        parent: cat({ id: 'cat-0' }),
        children: [],
      });

      expect(Object.keys(dto).sort()).toEqual([
        'children',
        'name',
        'parent',
        'slug',
      ]);
      expect(dto.parent).toEqual({
        slug: 'refrigeracion',
        name: 'Refrigeración',
      });
    });

    it('un rubro trae parent null y sus hijos como refs', () => {
      const dto = StorefrontCategoryDto.from({
        ...cat(),
        parent: null,
        children: [cat({ id: 'c1', slug: 'compresores', name: 'Compresores' })],
      });

      expect(dto.parent).toBeNull();
      expect(dto.children).toEqual([
        { slug: 'compresores', name: 'Compresores' },
      ]);
    });

    it('el nodo del árbol omite parent', () => {
      const nodo = StorefrontCategoryDto.treeNode({ ...cat(), children: [] });

      expect(Object.keys(nodo).sort()).toEqual(['children', 'name', 'slug']);
      expect(nodo).not.toHaveProperty('parent');
    });

    it('no filtra id ni parent_id ni timestamps', () => {
      const dto = StorefrontCategoryDto.from({
        ...cat(),
        parent: null,
        children: [cat({ id: 'c1' })],
      });

      expect(dto).not.toHaveProperty('id');
      expect(dto).not.toHaveProperty('parent_id');
      expect(dto).not.toHaveProperty('created_at');
      expect(dto.children[0]).not.toHaveProperty('id');
    });
  });

  describe('ListStorefrontProductsQueryDto', () => {
    const parse = (q: Record<string, unknown>) => {
      const dto = plainToInstance(ListStorefrontProductsQueryDto, q);
      return { dto, errors: validateSync(dto) };
    };

    it('sin params aplica los defaults 20/0', () => {
      const { dto, errors } = parse({});
      expect(errors).toHaveLength(0);
      expect(dto.limit).toBe(20);
      expect(dto.offset).toBe(0);
    });

    it('convierte el string del query a number', () => {
      const { dto, errors } = parse({ limit: '50', offset: '100' });
      expect(errors).toHaveLength(0);
      expect(dto.limit).toBe(50);
      expect(dto.offset).toBe(100);
    });

    it('rechaza limit fuera de 1..100 (AC-7: nunca el catálogo entero)', () => {
      expect(parse({ limit: '150' }).errors).not.toHaveLength(0);
      expect(parse({ limit: '0' }).errors).not.toHaveLength(0);
    });

    it('rechaza offset negativo', () => {
      expect(parse({ offset: '-1' }).errors).not.toHaveLength(0);
    });
  });
});
