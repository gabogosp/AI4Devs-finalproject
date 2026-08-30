import { test, expect } from '@playwright/test';
import { seedCarrito, type SeedCarrito } from '../support/seed-carrito';

/**
 * QA-008-E2E-1 — el checkout **completo** en el navegador (US-008, Layer 3).
 *
 * Corre contra FE y BE reales, sin el stub de `apps/web/e2e/support/api-stub.mjs`:
 * agregar al carrito → `/carrito` → "Ir al pago" → `/checkout` → completar →
 * confirmar → orden creada de verdad en `pending_payment`. Cubre SC-008-H1 (feliz),
 * SC-008-A3 (consentimiento, mitad UI) y SC-008-X3 (los links legales resuelven de
 * verdad contra el build real, no el markup leído en el código — la mitad que
 * `checkout.feature` no puede probar porque no hay UI a ese nivel).
 *
 * No duplica el E2E dev-owned del FE (`apps/web/e2e/checkout-happy-path.spec.ts`,
 * `checkout-topology.spec.ts`): esos corren contra el stub, sin backend real ni base
 * de datos, y prueban topología. Este es el único que prueba el acuerdo real entre
 * las tres capas.
 */

let seed: SeedCarrito;

test.beforeAll(async () => {
  seed = await seedCarrito();
});

test('SC-008-H1/A3/X3: checkout completo contra FE y BE reales', async ({ page }) => {
  // 1. Agrega el producto desde la ficha pública, navega al carrito.
  await page.goto(`/productos/${seed.mixtoA.slug}`);
  await page.getByRole('button', { name: /agregar al carrito/i }).click();
  await expect(page.getByRole('status')).toContainText(/agregaste/i);
  await page.goto('/carrito');

  // 2. El CTA "Ir al pago" está habilitado (carrito sin bloqueos) y navega a /checkout real.
  const irAlPago = page.getByRole('button', { name: /ir al pago/i });
  await expect(irAlPago).toBeEnabled();
  await irAlPago.click();
  await expect(page).toHaveURL(/\/checkout$/);

  // 3. Completa nombre/email/teléfono válidos.
  await page.getByLabel(/nombre/i).fill('Cliente E2E');
  await page.getByLabel(/email/i).fill('cliente.e2e@example.com');
  await page.getByLabel(/teléfono/i).fill('+54 9 11 5555 5555');

  // 4. SC-008-X3: los links legales del CHECKBOX de consentimiento — se
  //    escopea al <form> (el footer, fuera del form, también linkea a
  //    /legales/* pero con distinta capitalización: "Política de privacidad"
  //    vs "política de privacidad" de CONSENT_COPY). Case-sensitive a
  //    propósito para desambiguar entre los dos.
  const formulario = page.locator('form');
  const linkPrivacidad = formulario.getByRole('link', { name: 'política de privacidad' });
  const linkTerminos = formulario.getByRole('link', { name: 'términos' });
  await expect(linkPrivacidad).toHaveAttribute('href', '/legales/privacidad');
  await expect(linkTerminos).toHaveAttribute('href', '/legales/terminos');

  // 5. SC-008-A3 (mitad UI): confirmar SIN el consentimiento marcado no navega ni
  //    dispara el POST — el banner queda visible.
  const confirmar = page.getByRole('button', { name: /confirmar pedido/i });
  const sinConsentimiento = page.waitForResponse('**/v1/checkout', { timeout: 2_000 }).catch(() => null);
  await confirmar.click();
  const respuestaSinConsentimiento = await sinConsentimiento;
  expect(respuestaSinConsentimiento, 'no debía dispararse POST /v1/checkout sin consentimiento').toBeNull();
  await expect(page.getByText(/tenés que aceptar los términos/i)).toBeVisible();
  await expect(page).toHaveURL(/\/checkout$/);

  // 6. SC-008-H1: marca el checkbox, confirma, espera la respuesta REAL del backend.
  await page.getByRole('checkbox').check();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/v1/checkout') && r.request().method() === 'POST'),
    confirmar.click(),
  ]);
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { order_number: number; status: string };
  expect(body.status).toBe('pending_payment');

  // 7. La confirmación muestra el order_number REAL de la respuesta.
  await expect(page.getByRole('heading', { name: /pedido quedó registrado/i })).toBeVisible();
  await expect(page.getByText(`#${body.order_number}`)).toBeVisible();
});
