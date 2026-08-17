import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { server } from '@/test/server';
import { CategoryForm } from './categories/CategoryForm';
import { CategoriesList } from './categories/CategoriesList';
import { CategoriesPage } from './categories/CategoriesPage';
import { ProductForm } from './products/ProductForm';
import { ProductList } from './products/ProductList';
import { ProductActions } from './products/ProductActions';
import type { Category } from './categories/categoriesService';
import type { Product } from './products/productsService';

expect.extend(toHaveNoViolations);

const API = 'http://localhost:3000';

const categories: Category[] = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'refrigeracion',
    name: 'Refrigeración',
    parent_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

const product: Product = {
  id: '11111111-1111-4111-8111-111111111111',
  sku: 'REF-001',
  slug: 'heladera',
  name: 'Heladera',
  description_raw: null,
  price_ars_cents: 100000,
  stock: 5,
  status: 'draft',
  category_id: categories[0].id,
  image_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

// Fragmentos de componente: se desactiva la regla de landmark (aplica a página completa).
const axeOptions = { rules: { region: { enabled: false } } };

describe('a11y — componentes del panel (axe-core, sin violaciones)', () => {
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

  it('ProductActions (publicar / archivar — confirmación destructiva)', async () => {
    const { container } = render(<ProductActions product={product} />);
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });
});

describe('a11y — pantallas del panel (página completa, landmarks activos)', () => {
  it('ProductList (tabla TanStack, datos cargados)', async () => {
    server.use(
      http.get(`${API}/v1/admin/products`, () =>
        HttpResponse.json({
          data: [product],
          pagination: { limit: 20, offset: 0, total: 1 },
        }),
      ),
    );
    const { container } = render(
      <main>
        <h1>Productos</h1>
        <ProductList />
      </main>,
    );
    await screen.findByText('Heladera');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('CategoriesPage (alta + listado)', async () => {
    server.use(
      http.get(`${API}/v1/admin/categories`, () =>
        HttpResponse.json(categories),
      ),
    );
    const { container } = render(
      <main>
        <h1>Categorías</h1>
        <CategoriesPage />
      </main>,
    );
    await screen.findByText('Refrigeración');
    expect(await axe(container)).toHaveNoViolations();
  });
});
