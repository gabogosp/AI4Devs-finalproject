import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { CategoryForm } from './categories/CategoryForm';
import { CategoriesList } from './categories/CategoriesList';
import { ProductForm } from './products/ProductForm';
import type { Category } from './categories/categoriesService';

expect.extend(toHaveNoViolations);

const categories: Category[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    slug: 'refrigeracion',
    name: 'Refrigeración',
    parent_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

// Fragmentos de componente: se desactiva la regla de landmark (aplica a página completa).
const axeOptions = { rules: { region: { enabled: false } } };

describe('a11y — pantallas del panel (axe-core, sin violaciones)', () => {
  it('CategoryForm', async () => {
    const { container } = render(<CategoryForm />);
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it('ProductForm', async () => {
    const { container } = render(<ProductForm categories={categories} />);
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it('CategoriesList (con datos)', async () => {
    const { container } = render(
      <CategoriesList
        state={{ status: 'success', data: categories }}
        onRetry={() => {}}
      />,
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });
});
