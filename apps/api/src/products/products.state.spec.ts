import {
  assertPublishable,
  assertValidTransition,
  PublishRequirements,
} from './products.state';
import { InvalidTransitionError } from '../common/errors/domain-errors';

const complete: PublishRequirements = {
  name: 'Heladera',
  price_ars_cents: 100000,
  stock: 5,
  category_id: '00000000-0000-0000-0000-000000000001',
};

describe('products.state — transiciones', () => {
  it('permite las transiciones válidas', () => {
    expect(() => assertValidTransition('draft', 'published')).not.toThrow();
    expect(() => assertValidTransition('draft', 'archived')).not.toThrow();
    expect(() => assertValidTransition('published', 'archived')).not.toThrow();
    expect(() => assertValidTransition('published', 'draft')).not.toThrow();
  });

  it('rechaza transiciones inválidas', () => {
    expect(() => assertValidTransition('archived', 'published')).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertValidTransition('draft', 'draft')).toThrow(
      InvalidTransitionError,
    );
  });
});

describe('products.state — requisitos de publicación (AC-6)', () => {
  it('un producto completo se puede publicar', () => {
    expect(() => assertPublishable(complete)).not.toThrow();
  });

  it('sin categoría → error listando category_id', () => {
    try {
      assertPublishable({ ...complete, category_id: null });
      fail('debería haber lanzado');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const fields = (e as InvalidTransitionError).fieldErrors?.map(
        (f) => f.field,
      );
      expect(fields).toContain('category_id');
    }
  });

  it('sin nombre y precio <= 0 → error listando ambos', () => {
    try {
      assertPublishable({ ...complete, name: '', price_ars_cents: 0 });
      fail('debería haber lanzado');
    } catch (e) {
      const fields = (e as InvalidTransitionError).fieldErrors?.map(
        (f) => f.field,
      );
      expect(fields).toEqual(expect.arrayContaining(['name', 'price_ars_cents']));
    }
  });
});
