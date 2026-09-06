import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminAuth } from '../support/admin-auth';
import { catalogoParaMetricas, crearOrdenActiva } from '../support/seed-metricas';

/**
 * QA-013-A11Y-1 — accesibilidad L3 (axe-core + teclado) de "Cancelar orden"
 * contra la página SERVIDA, con el `ConfirmDialog` real ABIERTO (focus trap
 * real, no simulado) — capa distinta de `a11y.test.tsx` del FE (jest-axe en
 * jsdom, sin navegador real).
 */

async function loginComoAdmin(page: Page): Promise<string> {
  const token = await adminAuth();
  await page.addInitScript((t) => {
    window.sessionStorage.setItem('dsm.admin.token', t);
  }, token);
  return token;
}

async function auditarWcagAA(page: Page, estado: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const serias = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serias.map((v) => `${v.id}: ${v.help}`),
    `violaciones serious/critical en "Cancelar orden" (${estado})`,
  ).toEqual([]);
}

test('QA-013-A11Y-1a — OrderDetail con "Cancelar orden" visible, diálogo cerrado: sin violaciones', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const orden = await crearOrdenActiva('new', { adminToken, catalogo });

  await page.goto(`/admin/ordenes/${orden.id}`);
  await expect(page.getByRole('button', { name: 'Cancelar orden' })).toBeVisible();
  await auditarWcagAA(page, 'diálogo cerrado');
});

test('QA-013-A11Y-1b — con el ConfirmDialog real abierto: sin violaciones, foco atrapado', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const orden = await crearOrdenActiva('new', { adminToken, catalogo });

  await page.goto(`/admin/ordenes/${orden.id}`);
  await page.getByRole('button', { name: 'Cancelar orden' }).click();

  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toHaveAttribute('aria-modal', 'true');
  await auditarWcagAA(page, 'diálogo abierto');

  // El foco entra al input al abrir (design.md, ConfirmDialog).
  const input = page.getByLabel('Escribí "CANCELAR" para confirmar');
  await expect(input).toBeFocused();

  // Escribe "CANCELAR" para habilitar el botón de confirmar ANTES de probar el
  // orden de tabulación — un botón disabled es correctamente salteado por Tab
  // (comportamiento accesible, no un defecto), así que probar el foco con el
  // botón todavía disabled daría un falso negativo.
  await input.fill('CANCELAR');

  // Navegable/operable sólo con teclado: Tab llega al botón "Cancelar" (ghost)
  // y luego al de confirmar, ambos dentro del diálogo.
  await page.keyboard.press('Tab');
  await expect(dialogo.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialogo.getByRole('button', { name: 'Cancelar orden' })).toBeFocused();

  // Escape cierra el diálogo sin llamar al servicio (T4.3 del FE, dev-owned;
  // acá sólo se confirma el efecto visible en un navegador real).
  await page.keyboard.press('Escape');
  await expect(dialogo).toHaveCount(0);
});
