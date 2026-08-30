import { expect, test } from '@playwright/test';

/**
 * US-008 FE T7.3 — el flujo completo contra la app **construida**.
 *
 * Agregar al carrito → `/carrito` → «Ir al pago» → `/checkout` → completar →
 * submit → confirmación con el `order_number` del stub. Selectores por
 * rol/label (`playwright-stability`), sin CSS frágil.
 */
test.describe('Checkout — camino feliz (T7.3)', () => {
  test('completa el checkout y llega a la confirmación con el order_number', async ({ page }) => {
    await page.goto('/productos/heladera-exhibidora');
    const [agregar] = await Promise.all([
      page.waitForResponse('**/v1/cart/items/**'),
      page.getByRole('button', { name: /agregar al carrito/i }).click(),
    ]);
    expect(agregar.status(), await agregar.text()).toBe(200);

    await page.goto('/carrito');
    await expect(page.getByRole('button', { name: /ir al pago/i })).toBeEnabled();
    await page.getByRole('button', { name: /ir al pago/i }).click();

    await expect(page).toHaveURL(/\/checkout$/);
    await page.getByLabel(/nombre/i).fill('Ana Gómez');
    await page.getByLabel(/email/i).fill('ana@example.com');
    await page.getByLabel(/teléfono/i).fill('+54 9 11 5555 5555');
    await page.getByRole('checkbox').check();

    const [res] = await Promise.all([
      page.waitForResponse('**/v1/checkout'),
      page.getByRole('button', { name: /confirmar pedido/i }).click(),
    ]);
    expect(res.status()).toBe(201);
    const body = await res.json();

    await expect(page.getByRole('heading', { name: /pedido quedó registrado/i })).toBeVisible();
    await expect(page.getByText(`#${body.order_number}`)).toBeVisible();
  });

  test('sin consentimiento marcado, el submit no avanza ni crea la orden', async ({ page }) => {
    await page.goto('/productos/heladera-exhibidora');
    const [agregar] = await Promise.all([
      page.waitForResponse('**/v1/cart/items/**'),
      page.getByRole('button', { name: /agregar al carrito/i }).click(),
    ]);
    expect(agregar.status(), await agregar.text()).toBe(200);

    await page.goto('/carrito');
    await page.getByRole('button', { name: /ir al pago/i }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    await page.getByLabel(/nombre/i).fill('Ana Gómez');
    await page.getByLabel(/email/i).fill('ana@example.com');
    await page.getByLabel(/teléfono/i).fill('+54 9 11 5555 5555');
    // Consentimiento SIN marcar a propósito.

    await page.getByRole('button', { name: /confirmar pedido/i }).click();

    // Se queda en el formulario, con el error visible — no navega ni confirma.
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByText(/tenés que aceptar los términos/i)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /pedido quedó registrado/i }),
    ).not.toBeVisible();
  });
});
