import { test, expect, type Route } from '@playwright/test';

// El backend no corre en este smoke: se mockea el contrato /v1/admin/* en el
// borde de red del browser (Playwright route). La batería de aceptación real
// (contra la API viva) es owned-by-QA (/develop-qa), no acá.
const CAT_ID = '00000000-0000-0000-0000-000000000001';

const category = {
  id: CAT_ID,
  slug: 'refrigeracion',
  name: 'Refrigeración',
  parent_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

const product = (status = 'draft') => ({
  id: 'p1',
  sku: 'REF-001',
  name: 'Heladera',
  description_raw: null,
  price_ars_cents: 100000,
  stock: 5,
  status,
  category_id: CAT_ID,
  image_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

test('happy path: acceso → categoría → producto draft → publicar', async ({
  page,
}) => {
  await page.route('**/v1/admin/auth/login', (r) => json(r, 200, { token: 'jwt-admin' }));
  await page.route('**/v1/admin/categories', (r) =>
    r.request().method() === 'POST'
      ? json(r, 201, category)
      : json(r, 200, [category]),
  );
  await page.route(/\/v1\/admin\/products(\?.*)?$/, (r) =>
    r.request().method() === 'POST'
      ? json(r, 201, product())
      : json(r, 200, {
          data: [product()],
          pagination: { limit: 20, offset: 0, total: 1 },
        }),
  );
  // Más específica: se registra al final para tener precedencia sobre la anterior.
  await page.route('**/v1/admin/products/p1', (r) =>
    r.request().method() === 'PATCH'
      ? json(r, 200, product('published'))
      : json(r, 200, product()),
  );

  // 1) Acceso admin
  await page.goto('/acceso');
  await page.getByLabel(/Token de acceso/).fill('seed-token');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/productos/);

  // 2) Crear categoría
  await page.goto('/categorias');
  await page.getByLabel(/Nombre/).fill('Refrigeración');
  await page.getByRole('button', { name: 'Crear' }).click();

  // 3) Alta de producto en borrador
  await page.goto('/productos/nuevo');
  await page.getByLabel(/SKU/).fill('REF-001');
  await page.getByLabel(/Nombre/).fill('Heladera');
  await page.getByLabel(/Precio/).fill('1000');
  await page.getByLabel(/Stock/).fill('5');
  await page.getByLabel(/Categoría/).selectOption(CAT_ID);
  await page.getByRole('button', { name: /Crear en borrador/ }).click();
  await expect(page.getByText(/Creado en borrador/)).toBeVisible();

  // 4) Publicar
  await page.goto('/productos/p1');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByTestId('product-status')).toHaveText('published');
});
