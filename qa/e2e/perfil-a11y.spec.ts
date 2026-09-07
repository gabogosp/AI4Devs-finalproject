import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { datosDeCuenta } from '../support/customer-auth';

/**
 * QA-024-A11Y-1 (US-024, `qa-plan.md` §5) — cierra el `Blocked-by: FE-US-024`
 * de `tasks.md` ahora que el FE aterrizó (PR #133). Mismo patrón que
 * `cuenta-a11y.spec.ts` (US-014): axe-core WCAG 2.1 AA contra la app
 * construida y el backend real.
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

/**
 * `POST /auth/register` tiene su propio presupuesto endurecido (literal en
 * `customer-auth.controller.ts`, no lee `AUTH_RATE_LIMIT_MAX`) — ver la nota
 * completa en `perfil.spec.ts`. Mismo fix: `X-Forwarded-For` por página.
 */
let ip = 0;
const proximaIp = (): string => {
  ip += 1;
  return `10.25.${(ip >> 8) & 255}.${ip & 255}`;
};

async function registrar(page: Page, sufijo: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': proximaIp() });
  const cuenta = datosDeCuenta(sufijo);
  await page.goto('/crear-cuenta');
  await page.getByLabel(/nombre/i).fill(cuenta.nombre);
  await page.getByLabel(/email/i).fill(cuenta.email);
  await page.getByLabel(/contraseña/i).fill(cuenta.password);
  await Promise.all([
    page.waitForResponse('**/v1/auth/register'),
    page.getByRole('button', { name: /crear cuenta/i }).click(),
  ]);
  await expect(page).toHaveURL(/\/mi-cuenta$/);
  return cuenta;
}

test.describe('QA-024-A11Y-1: accesibilidad del form de edición de perfil', () => {
  test('el form de edición de perfil (con placeholder de avatar) no tiene violaciones AA', async ({
    page,
  }) => {
    await registrar(page, '-a11y-perfil-sin-avatar');
    await auditarWcagAA(page);
  });

  test('el placeholder de avatar (iniciales) tiene un nombre accesible que lo describe como avatar', async ({
    page,
  }) => {
    const cuenta = await registrar(page, '-a11y-perfil-placeholder');

    // Avatar.tsx: `role="img"` + `aria-label="Avatar de {name}"` en el estado
    // sin URL — no es una imagen rota sin describir.
    const placeholder = page.getByRole('img', { name: new RegExp(`avatar de ${cuenta.nombre}`, 'i') });
    await expect(placeholder).toBeVisible();
  });

  test('el form con un avatar real (imagen, no placeholder) tampoco tiene violaciones AA', async ({
    page,
  }) => {
    const cuenta = await registrar(page, '-a11y-perfil-con-avatar');

    const form = page.getByRole('form', { name: /editar perfil/i });
    await form.getByLabel(/avatar/i).fill('https://picsum.photos/200');
    await Promise.all([
      page.waitForResponse('**/v1/me'),
      form.getByRole('button', { name: /^guardar$/i }).click(),
    ]);
    await expect(page.getByRole('img', { name: new RegExp(`avatar de ${cuenta.nombre}`, 'i') })).toHaveAttribute(
      'src',
      'https://picsum.photos/200',
    );

    await auditarWcagAA(page);
  });

  test('editar el nombre y guardar se completa sólo con teclado', async ({ page }) => {
    // `registrar()` ya deja al navegador en /mi-cuenta con el form montado
    // (AC-1) — un segundo `goto` + `networkidle` acá es redundante y, contra
    // esta ruta puntual, no termina de asentarse (Playwright desaconseja
    // depender de `networkidle` por esto mismo).
    await registrar(page, '-a11y-perfil-teclado');

    const nombreInput = page.getByRole('form', { name: /editar perfil/i }).getByLabel(/nombre/i);
    await nombreInput.click();
    // Selecciona todo el valor precargado antes de tipar — Ctrl+A funciona
    // igual en macOS dentro de Chromium/Playwright.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Nombre Editado Por Teclado');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('status')).toHaveText(/perfil actualizado/i);
  });

  test('el error de avatar inválido queda asociado al campo por nombre accesible', async ({ page }) => {
    await registrar(page, '-a11y-perfil-error-avatar');

    const form = page.getByRole('form', { name: /editar perfil/i });
    const avatarInput = form.getByLabel(/avatar/i);
    await avatarInput.fill('no-es-una-url');
    await form.getByRole('button', { name: /^guardar$/i }).click();

    const describedBy = await avatarInput.getAttribute('aria-describedby');
    expect(describedBy, 'el input de avatar debe declarar aria-describedby hacia su error').toBeTruthy();
    const id = describedBy!.split(' ')[0]!;
    const texto = await page.locator(`[id="${id}"]`).textContent();
    expect(texto?.length ?? 0).toBeGreaterThan(0);

    await auditarWcagAA(page);
  });
});
