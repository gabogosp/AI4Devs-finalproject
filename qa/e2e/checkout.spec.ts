import { test, expect } from '@playwright/test';
import { seedCarrito, type SeedCarrito } from '../support/seed-carrito';

/**
 * QA-008-E2E-1 — checkout completo, FE real + BE real (Layer 3 de
 * `qa-three-layer-regression`; ver `qa-plan.md` §6).
 *
 * Cubre SC-008-H1 (feliz), SC-008-X3 (los links de consentimiento resuelven
 * de verdad contra el build real del FE, no el markup leído en el código) y
 * la mitad UI de SC-008-A3 (sin consentimiento, no hay submit).
 *
 * **No** duplica el smoke Layer 2 dev-owned de
 * `apps/web/e2e/checkout-happy-path.spec.ts` /
 * `checkout-topology.spec.ts` (esos corren contra el stub
 * `apps/web/e2e/support/api-stub.mjs`, sin backend real): éste es el único
 * spec que prueba el acuerdo real entre Postgres, `POST /v1/checkout` y un
 * navegador real.
 *
 * Selectores por rol/label (`playwright-stability` §Selectors); las esperas
 * asertan el estado siguiente o la respuesta de red — ningún
 * `waitForTimeout`.
 */

let seed: SeedCarrito;

test.beforeAll(async () => {
  seed = await seedCarrito();
});

interface CheckoutCreatedBody {
  order_token: string;
  order_number: number;
  status: string;
  total_ars_cents: number;
  items_count: number;
}

test.describe('QA-008-E2E-1 — checkout guest cross-stack', () => {
  test('SC-008-H1/X3: agregar → carrito → checkout → consentimiento real → 201 → confirmación', async ({
    page,
  }) => {
    // 1. Agrega desde la ficha pública — el camino real del comprador.
    await page.goto(`/productos/${seed.mixtoA.slug}`);
    await page.getByRole('button', { name: /agregar al carrito/i }).click();
    await expect(page.getByRole('status')).toContainText(/agregaste/i);

    // 2. /carrito → "Ir al pago" habilitado (sin has_blocking_issues) → /checkout.
    await page.goto('/carrito');
    const irAlPago = page.getByRole('button', { name: /ir al pago/i });
    await expect(irAlPago).toBeEnabled();
    await irAlPago.click();
    await expect(page).toHaveURL(/\/checkout/);

    // 3. Completa datos válidos del comprador.
    await page.getByLabel(/nombre/i).fill('Comprador E2E QA-008');
    await page.getByLabel(/email/i).fill('comprador-e2e-qa008@qa.dsm.local');
    await page.getByLabel(/teléfono/i).fill('+54 9 11 5555 5555');

    // 4. SC-008-X3 — los dos links del consentimiento resuelven DE VERDAD
    //    contra el build real (no el código fuente): ninguno es "#" y ambos
    //    apuntan al destino real de `LEGAL_ROUTES` (`features/legal/routes.ts`).
    //    Acotado al `<label>` del checkbox de consentimiento: el footer del
    //    sitio también linkea a las mismas dos páginas legales, y un locator
    //    sin acotar matchea ambos (violación de "strict mode").
    const consentimiento = page.locator('label[for="checkout-consent"]');
    const linkPrivacidad = consentimiento.getByRole('link', { name: /política de privacidad/i });
    const linkTerminos = consentimiento.getByRole('link', { name: /términos/i });
    await expect(linkPrivacidad).toBeVisible();
    await expect(linkTerminos).toBeVisible();
    const hrefPrivacidad = await linkPrivacidad.getAttribute('href');
    const hrefTerminos = await linkTerminos.getAttribute('href');
    expect(hrefPrivacidad).toBe('/legales/privacidad');
    expect(hrefTerminos).toBe('/legales/terminos');
    expect(hrefPrivacidad).not.toBe('#');
    expect(hrefTerminos).not.toBe('#');

    // 5. Marca el consentimiento y confirma.
    await page.getByRole('checkbox').check();
    const respuestaCheckout = page.waitForResponse(
      (res) => res.url().includes('/v1/checkout') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /confirmar pedido/i }).click();

    // 6. Espera la respuesta REAL de POST /v1/checkout — 201.
    const res = await respuestaCheckout;
    expect(res.status()).toBe(201);
    const body = (await res.json()) as CheckoutCreatedBody;
    expect(body.order_number).toBeGreaterThanOrEqual(1000);
    expect(body.order_token).toMatch(/^[0-9a-f]{64}$/);

    // 7. La confirmación en pantalla coincide con la respuesta real.
    await expect(
      page.getByRole('heading', { name: /pedido quedó registrado/i }),
    ).toBeVisible();
    await expect(page.getByText(`#${body.order_number}`)).toBeVisible();
  });

  test('SC-008-A3 (mitad UI): sin consentimiento, el submit no navega ni dispara la request', async ({
    page,
  }) => {
    await page.goto(`/productos/${seed.mixtoB.slug}`);
    await page.getByRole('button', { name: /agregar al carrito/i }).click();
    await expect(page.getByRole('status')).toContainText(/agregaste/i);

    await page.goto('/carrito');
    await page.getByRole('button', { name: /ir al pago/i }).click();
    await expect(page).toHaveURL(/\/checkout/);

    await page.getByLabel(/nombre/i).fill('Comprador E2E QA-008 Sin Consentimiento');
    await page.getByLabel(/email/i).fill('sin-consentimiento-qa008@qa.dsm.local');
    await page.getByLabel(/teléfono/i).fill('+54 9 11 5555 5556');

    let disparoCheckout = false;
    page.on('request', (req) => {
      if (req.url().includes('/v1/checkout') && req.method() === 'POST') {
        disparoCheckout = true;
      }
    });

    // NO marca el checkbox de consentimiento — intenta confirmar igual.
    await page.getByRole('button', { name: /confirmar pedido/i }).click();

    // El banner de validación queda visible (mismo copy de `checkoutFieldMessages.ts`).
    await expect(page.getByText(/tenés que aceptar los términos/i)).toBeVisible();

    // No navegó (sigue en /checkout) y jamás salió la request real.
    await expect(page).toHaveURL(/\/checkout/);
    expect(disparoCheckout).toBe(false);
  });
});
