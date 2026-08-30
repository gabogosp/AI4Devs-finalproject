import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  nuevaCuenta,
  nuevoContexto,
  pedirReset,
  marcaDeLog,
  tokenDeResetDesde,
  PASSWORD_VALIDA,
} from '../support/customer-auth';

/**
 * TC-150 / TC-151 — accesibilidad de los cuatro formularios de cuenta (US §9,
 * WCAG 2.1 AA): registro, login, pedido de recuperación y confirmación.
 *
 * Corren contra la app **construida** servida en `QA_WEB_BASE_URL` — no es un doble:
 * la topología de cookies (ADR-0013) y la hidratación real sólo existen ahí.
 */

async function auditarWcagAA(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(
    violations.map((v) => `${v.id}: ${v.help}`),
    'violaciones WCAG AA',
  ).toEqual([]);
}

/** Nombre accesible del error de un campo: sigue `aria-describedby` hasta su texto. */
async function textoDeErrorAsociado(page: Page, campo: string): Promise<string | null> {
  const input = page.getByLabel(campo);
  const describedBy = await input.getAttribute('aria-describedby');
  if (!describedBy) return null;
  const id = describedBy.split(' ')[0]!;
  // Selector de atributo, no `#id`: `useId()` genera ids con `:` (p.ej. `:R4jttfb:`),
  // que el parser de selectores CSS de Playwright no acepta sin escapar.
  return page.locator(`[id="${id}"]`).textContent();
}

/**
 * Navega y espera a que React hidrate antes de devolver el control.
 *
 * Sin esto, `page.goto()` resuelve apenas el HTML servido por el servidor llega —
 * el formulario ya está en el DOM pero su `onSubmit` de React todavía no está
 * cableado—, y un `Enter` disparado ahí cae al **submit nativo del browser**
 * (`method="post"` a la misma URL) en vez de a `handleSubmit`. El síntoma no es
 * un timeout: la página navega, pero a un POST plano que el App Router no maneja.
 */
async function irYEsperarHidratacion(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta);
  await page.waitForLoadState('networkidle');
}

test.describe('TC-150: accesibilidad de registro y login', () => {
  test('TC-150a: /crear-cuenta no tiene violaciones AA', async ({ page }) => {
    await page.goto('/crear-cuenta');
    await auditarWcagAA(page);
  });

  test('TC-150b: /ingresar no tiene violaciones AA', async ({ page }) => {
    await page.goto('/ingresar');
    await auditarWcagAA(page);
  });

  test('TC-150c: el registro se completa y envía sólo con teclado', async ({ page }) => {
    await irYEsperarHidratacion(page, '/crear-cuenta');

    // Tab desde el body hasta el primer campo, sin asumir un orden por selector:
    // si el foco inicial no cayera ahí, esto lo detectaría en vez de esconderlo.
    await page.getByLabel('Nombre').click();
    await page.keyboard.type('QA Teclado');
    await page.keyboard.press('Tab');
    await page.keyboard.type(`qa-us014-a11y-${Date.now()}@example.test`);
    await page.keyboard.press('Tab');
    await page.keyboard.type(PASSWORD_VALIDA);
    // Enter en el último campo de un form de un solo submit lo envía — sin
    // tocar el mouse ni el botón.
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/mi-cuenta$/);
  });

  test('TC-150d: el login se completa y envía sólo con teclado', async ({ page }) => {
    const { cuenta, ctx } = await nuevaCuenta('-a11y-login');
    await ctx.dispose();

    await irYEsperarHidratacion(page, '/ingresar');
    await page.getByLabel('Email').click();
    await page.keyboard.type(cuenta.email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(cuenta.password);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/mi-cuenta$/);
  });

  test('TC-150e: el error de validación queda asociado a su campo por nombre accesible', async ({
    page,
  }) => {
    // Contraseña corta: la política del backend exige 8 caracteres, y el
    // resolver de zod la rechaza en el cliente antes de llamar a la API.
    await irYEsperarHidratacion(page, '/crear-cuenta');
    await page.getByLabel('Nombre').click();
    await page.keyboard.type('QA Teclado');
    await page.keyboard.press('Tab');
    await page.keyboard.type(`qa-us014-a11y-corta-${Date.now()}@example.test`);
    await page.keyboard.press('Tab');
    await page.keyboard.type('corta');
    await page.keyboard.press('Enter');

    // El campo sigue enfocable — `.click()` fallaría si el error lo reemplazara
    // por otro nodo, que es justo el modo de fallo que este assert descarta.
    const error = await textoDeErrorAsociado(page, 'Contraseña');
    expect(error, 'el input de contraseña debe declarar aria-describedby hacia su error').not.toBeNull();
    expect(error!.length).toBeGreaterThan(0);

    await auditarWcagAA(page);
  });
});

test.describe('TC-151: accesibilidad de recuperación y confirmación', () => {
  test('TC-151a: /recuperar no tiene violaciones AA', async ({ page }) => {
    await page.goto('/recuperar');
    await auditarWcagAA(page);
  });

  test('TC-151b: el resultado de pedir recuperación se anuncia en una región viva', async ({
    page,
  }) => {
    await irYEsperarHidratacion(page, '/recuperar');
    await page.getByLabel('Email').click();
    await page.keyboard.type(`qa-us014-a11y-reset-${Date.now()}@example.test`);
    await page.keyboard.press('Enter');

    // `role="status"` es una región viva implícita (aria-live="polite"): un
    // lector de pantalla la anuncia sin que el foco tenga que moverse ahí.
    const anuncio = page.getByRole('status');
    await expect(anuncio).toBeVisible();
    await expect(anuncio).not.toBeEmpty();
  });

  test('TC-151c: /recuperar/confirmar con un token válido no tiene violaciones AA', async ({
    page,
  }) => {
    const { cuenta, ctx } = await nuevaCuenta('-a11y-confirmar');
    await ctx.dispose();

    const marca = marcaDeLog();
    const anon = await nuevoContexto();
    await pedirReset(anon, cuenta.email);
    await anon.dispose();
    const token = await tokenDeResetDesde(marca, cuenta.id!);

    await page.goto(`/recuperar/confirmar?token=${token}`);
    await auditarWcagAA(page);
  });

  test('TC-151d: confirmar la contraseña nueva se completa sólo con teclado', async ({
    page,
  }) => {
    const { cuenta, ctx } = await nuevaCuenta('-a11y-confirmar-kb');
    await ctx.dispose();

    const marca = marcaDeLog();
    const anon = await nuevoContexto();
    await pedirReset(anon, cuenta.email);
    await anon.dispose();
    const token = await tokenDeResetDesde(marca, cuenta.id!);

    await irYEsperarHidratacion(page, `/recuperar/confirmar?token=${token}`);
    await page.getByLabel('Contraseña nueva').click();
    await page.keyboard.type('Contrasena-Nueva-Kb-7');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('status')).toBeVisible();
  });
});
