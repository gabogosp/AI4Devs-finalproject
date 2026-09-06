import { test, expect, type Page } from '@playwright/test';
import { adminAuth } from '../support/admin-auth';
import { cancelarOrden } from '../support/cancelar-orden';
import { nuevaCuenta } from '../support/customer-auth';
import { avanzarEstado, catalogoParaMetricas, crearOrdenActiva } from '../support/seed-metricas';

/**
 * QA-013-E2E-1..6 — la acción de cancelar (US-013) contra un backend +
 * frontend reales, en un navegador real. Login inyectando el token REAL de
 * `admin-auth.ts` en `sessionStorage` (mecanismo actual del panel,
 * `adminSession.ts`) — mismo criterio que `ordenes.spec.ts`.
 *
 * Corregido respecto al `qa-plan.md` original: NO está bloqueado por el
 * merge de la PR #67 — este worktree tiene el código de `OrderCancelAction`
 * stacked, y `apps/web` se construyó y sirve desde acá mismo.
 */

async function loginComoAdmin(page: Page): Promise<string> {
  const token = await adminAuth();
  await page.addInitScript((t) => {
    window.sessionStorage.setItem('dsm.admin.token', t);
  }, token);
  return token;
}

test('QA-013-E2E-1 — E-1: confirmación de dos pasos dispara la cancelación real (AC-1/AC-6)', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const orden = await crearOrdenActiva('new', { adminToken, catalogo });

  await page.goto(`/admin/ordenes/${orden.id}`);
  await page.getByRole('button', { name: 'Cancelar orden' }).click();

  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  const confirmar = dialogo.getByRole('button', { name: 'Cancelar orden' });
  await expect(confirmar).toBeDisabled();

  await page.getByLabel('Escribí "CANCELAR" para confirmar').fill('CANCELAR');
  await expect(confirmar).toBeEnabled();

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/orders/${orden.id}/cancel`) && r.request().method() === 'POST'),
    confirmar.click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(page.getByText('Cancelada', { exact: true })).toBeVisible();
});

test('QA-013-E2E-2 — E-2: el botón no se renderiza en órdenes entregada/cancelada (AC-1/AC-7)', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const entregada = await crearOrdenActiva('delivered', { adminToken, catalogo });
  const cancelada = await crearOrdenActiva('new', { adminToken, catalogo });
  const r = await cancelarOrden(adminToken, cancelada.id);
  expect(r.status).toBe(200);

  await page.goto(`/admin/ordenes/${entregada.id}`);
  await expect(page.getByRole('button', { name: 'Cancelar orden' })).toHaveCount(0);

  await page.goto(`/admin/ordenes/${cancelada.id}`);
  await expect(page.getByRole('button', { name: 'Cancelar orden' })).toHaveCount(0);
});

test('QA-013-E2E-3 — E-3: mensaje de reembolso para pago manual y simulado (AC-5 parcial)', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const orden = await crearOrdenActiva('new', { adminToken, catalogo });

  await page.goto(`/admin/ordenes/${orden.id}`);
  await page.getByRole('button', { name: 'Cancelar orden' }).click();
  await page.getByLabel('Escribí "CANCELAR" para confirmar').fill('CANCELAR');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar orden' }).click();

  await expect(
    page.getByRole('status').filter({ hasText: 'Se canceló la orden y se reintegró el pago.' }),
  ).toBeVisible();
});

test('QA-013-E2E-4 — E-4: 409 real deja el diálogo abierto con mensaje específico (AC-7 negativo)', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const orden = await crearOrdenActiva('new', { adminToken, catalogo });

  await page.goto(`/admin/ordenes/${orden.id}`);
  await page.getByRole('button', { name: 'Cancelar orden' }).click();
  await page.getByLabel('Escribí "CANCELAR" para confirmar').fill('CANCELAR');

  // Carrera real: la orden estaba "new" cuando la página cargó (botón visible,
  // cliente desactualizado) pero otra "pestaña" la avanza por fuera hasta
  // "delivered" (estado terminal) ANTES de que este click complete — mismo
  // patrón que `ordenes.spec.ts` TC-1223. Cancelar una orden YA "cancelled"
  // (en vez de "delivered") es idempotente (200, D3 del backend) — no
  // produce 409, así que ESTA es la única condición de carrera real que sí
  // lo hace.
  const p1 = await avanzarEstado(adminToken, orden.id, 'preparing');
  expect(p1.status).toBe(200);
  const p2 = await avanzarEstado(adminToken, orden.id, 'ready');
  expect(p2.status).toBe(200);
  const p3 = await avanzarEstado(adminToken, orden.id, 'delivered');
  expect(p3.status).toBe(200);

  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar orden' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'La orden ya no puede cancelarse' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('QA-013-E2E-5 — E-5: el historial muestra la fila nueva sin recargar (AC-10)', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const orden = await crearOrdenActiva('new', { adminToken, catalogo });

  await page.goto(`/admin/ordenes/${orden.id}`);
  const historialAntes = await page.locator('ul li').count();

  await page.getByRole('button', { name: 'Cancelar orden' }).click();
  await page.getByLabel('Escribí "CANCELAR" para confirmar').fill('CANCELAR');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/orders/${orden.id}/cancel`)),
    page.getByRole('dialog').getByRole('button', { name: 'Cancelar orden' }).click(),
  ]);

  // Sin ninguna navegación/recarga: el conteo de filas del historial creció en 1.
  await expect
    .poll(async () => page.locator('ul li').count())
    .toBeGreaterThan(historialAntes);
});

test('QA-013-E2E-6 — E-6: sin sesión de admin, ni con sesión de cliente real, se ve el panel (AC-9)', async ({
  page,
}) => {
  const adminToken = await adminAuth();
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });
  const orden = await crearOrdenActiva('new', { adminToken, catalogo });

  // Sin loginComoAdmin: sessionStorage vacío (visitante sin sesión).
  await page.goto(`/admin/ordenes/${orden.id}`);
  await page.waitForURL(/\/admin\/acceso/);
  await expect(page.getByRole('heading', { name: 'Acceso al panel' })).toBeVisible();

  // Cuenta de cliente real (US-014): se registra por la API real y su cookie
  // de sesión (dsm_access) se transplanta al contexto del navegador — sesión
  // real, no un mock — para probar que el guard del FE (que sólo mira el
  // token admin en sessionStorage) también rechaza a un cliente autenticado.
  const sesion = await nuevaCuenta('-us013-e6');
  const estadoStorage = await sesion.ctx.storageState();
  await page.context().addCookies(estadoStorage.cookies);
  await sesion.ctx.dispose();

  await page.goto(`/admin/ordenes/${orden.id}`);
  await page.waitForURL(/\/admin\/acceso/);
  await expect(page.getByRole('heading', { name: 'Acceso al panel' })).toBeVisible();
});
