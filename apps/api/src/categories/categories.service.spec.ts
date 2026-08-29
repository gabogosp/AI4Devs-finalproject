import { Category } from '@dsm/db';
import { CategoriesService } from './categories.service';
import { CategoriesRepository } from './categories.repository';
import { ConflictError } from '../common/errors/domain-errors';

function fakeCategory(over: Partial<Category>): Category {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    slug: 'x',
    name: 'X',
    parent_id: null,
    created_at: new Date(),
    ...over,
  } as Category;
}

describe('CategoriesService (categories.service)', () => {
  it('deriva el slug sin acentos del name ("Refrigeración" → "refrigeracion")', async () => {
    const repo = {
      create: jest.fn(async (d) => fakeCategory(d)),
    } as unknown as CategoriesRepository;
    const service = new CategoriesService(repo);

    await service.create({ name: 'Refrigeración' });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'refrigeracion', name: 'Refrigeración' }),
    );
  });

  it('deriva slug kebab de nombres con espacios ("Aires Split" → "aires-split")', async () => {
    const repo = {
      create: jest.fn(async (d) => fakeCategory(d)),
    } as unknown as CategoriesRepository;
    const service = new CategoriesService(repo);

    await service.create({ name: 'Aires Split' });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'aires-split' }),
    );
  });

  it('propaga ConflictError del repositorio (colisión de slug)', async () => {
    const repo = {
      create: jest.fn(async () => {
        throw new ConflictError('slug duplicado');
      }),
    } as unknown as CategoriesRepository;
    const service = new CategoriesService(repo);

    await expect(service.create({ name: 'Ferretería' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
