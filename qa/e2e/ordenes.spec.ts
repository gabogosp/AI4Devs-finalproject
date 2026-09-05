import { test, expect, type Page } from '@playwright/test';
import { adminAuth } from '../support/admin-auth';
import { crearOrdenEnEstado, avanzarEstado } from '../support/seed-ordenes';

/**
 * E-1..E-5 (T5.1-T5.3, TC-1220..TC-1224) — el panel de fulfillment contra un
 * navegador real. Login inyectando el token REAL de `admin-auth.ts` en
 * `sessionStorage` (mecanismo actual del panel, `adminSession.ts`) —
 * `per playwright-stability §Auth`, mismo criterio que `importar-a11y.spec.ts`.
 */

async function loginComoAdmin(page: Page): Promise<string> {
  const token = await adminAuth();
  await page.addInitScript((t) => {
    window.sessionStorage.setItem('dsm.admin.token', t);
  }, token);
  return token;
}

test('TC-1220 — E-1: el listado pagina, ordena con aria-sort y filtra por estado (AC-1/AC-5)', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const a = await crearOrdenEnEstado('new', {
    buyer: { name: 'E1 Cliente A', email: `e1a-${Date.now()}@qa.test`, phone: '+54 351 555 0301' },
    adminToken,
  });
  const b = await crearOrdenEnEstado('preparing', {
    buyer: { name: 'E1 Cliente B', email: `e1b-${Date.now()}@qa.test`, phone: '+54 351 555 0302' },
    adminToken,
  });

  await page.goto('/admin/ordenes');
  await expect(page.getByRole('table')).toBeVisible();

  // aria-sort en las 3 columnas ordenables (Nº de orden / Total / Fecha) —
  // ANTES de tocar el filtro, para no depender de un re-render intermedio.
  // `locator('th')` en vez de `getByRole('columnheader')`: el nombre accesible
  // de un `<th>` con un `<button>` adentro no siempre se resuelve igual entre
  // navegadores/versiones — el texto del `<th>` es un ancla más estable acá.
  const encabezados = ['Nº de orden', 'Total', 'Fecha'];
  for (const nombre of encabezados) {
    const th = page.locator('th').filter({ hasText: nombre });
    await expect(th).toHaveAttribute('aria-sort', 'none');
    await th.getByRole('button').click();
    await expect(th).toHaveAttribute('aria-sort', /ascending|descending/);
  }

  // "Cliente" no es ordenable — no tiene aria-sort en absoluto.
  await expect(page.locator('th').filter({ hasText: 'Cliente' })).not.toHaveAttribute(
    'aria-sort',
    /.+/,
  );

  // Recarga con el orden default (`-created_at`, más recientes primero): los 3
  // toggles de arriba dejaron el sort en un estado no-default, y sin esto la
  // orden recién creada podría caer fuera de la primera página.
  await page.goto('/admin/ordenes');
  await expect(page.getByRole('table')).toBeVisible();

  // Filtro por estado (AC-5): sólo la orden en "preparing" queda visible.
  await page.getByLabel('Estado:').selectOption('preparing');
  await expect(page.getByText(String(b.orderNumber))).toBeVisible();
  await expect(page.getByText(String(a.orderNumber))).toHaveCount(0);
});

test('TC-1221 — E-2: el detalle muestra ítems, contacto, retiro e historial (AC-2/AC-9)', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const orden = await crearOrdenEnEstado('preparing', {
    buyer: { name: 'E2 Cliente', email: `e2-${Date.now()}@qa.test`, phone: '+54 351 555 0303' },
    adminToken,
  });

  await page.goto(`/admin/ordenes/${orden.id}`);
  await expect(page.getByRole('heading', { name: `Orden #${orden.orderNumber}` })).toBeVisible();
  await expect(page.getByText(orden.items[0]!.productName)).toBeVisible();
  await expect(page.getByText(orden.buyer.email)).toBeVisible();
  await expect(page.getByText(orden.buyer.phone)).toBeVisible();
  await expect(page.getByText('Retiro en sucursal')).toBeVisible();
  // El historial (new→preparing) tiene al menos una entrada visible.
  await expect(page.getByText(/Nueva → Preparando/)).toBeVisible();
});

test('TC-1222 — E-3: avanzar con UI optimista y aviso de "lista" (AC-3/AC-4)', async ({ page }) => {
  const adminToken = await loginComoAdmin(page);
  const orden = await crearOrdenEnEstado('preparing', { adminToken });

  await page.goto(`/admin/ordenes/${orden.id}`);
  await page.getByRole('button', { name: 'Marcar como lista para retirar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Se avisó al cliente' })).toBeVisible();
  // `exact: true` — sin él, matchea también la línea del historial
  // ("Preparando → Lista para retirar"), que contiene el mismo texto como substring.
  await expect(page.getByText('Lista para retirar', { exact: true })).toBeVisible();
});

test('TC-1223 — E-4: 409 real revierte el estado optimista y avisa el conflicto (AC-6)', async ({
  page,
}) => {
  const adminToken = await loginComoAdmin(page);
  const orden = await crearOrdenEnEstado('new', { adminToken });

  await page.goto(`/admin/ordenes/${orden.id}`);
  // Espera a que el cliente termine de renderizar CONTRA "new" antes de mover
  // la orden por fuera — si no, la carrera podría resolverse antes del primer
  // render y el botón visible ya reflejaría el estado nuevo (falso positivo).
  const boton = page.getByRole('button', { name: 'Marcar como preparando' });
  await expect(boton).toBeVisible();

  // El navegador queda con "new" en memoria. Por fuera, avanzamos la orden REAL
  // más allá del próximo paso que el botón va a pedir — una carrera real contra
  // un cliente desactualizado, no un mock de red (tasks.md T5.2 Pattern).
  const p1 = await avanzarEstado(adminToken, orden.id, 'preparing');
  expect(p1.status).toBe(200);
  const p2 = await avanzarEstado(adminToken, orden.id, 'ready');
  expect(p2.status).toBe(200);

  // El botón visible sigue siendo "Marcar como preparando" (estado en memoria: "new").
  await boton.click();
  // `getByRole('alert')` sin filtrar matchea también el anunciador de rutas de
  // Next.js (`#__next-route-announcer__`, también role="alert").
  await expect(
    page.getByRole('alert').filter({ hasText: 'probablemente en otra pestaña' }),
  ).toBeVisible();
  // Revierte al badge ORIGINAL ("new" → "Nueva"), no se queda en el optimista.
  await expect(page.getByText('Nueva', { exact: true })).toBeVisible();
});

test('TC-1224 — E-5: sin sesión de admin, no ve el panel de órdenes (AC-7)', async ({ page }) => {
  // Sin loginComoAdmin: sessionStorage vacío.
  await page.goto('/admin/ordenes');
  await page.waitForURL(/\/admin\/acceso/);
  await expect(page.getByRole('heading', { name: 'Acceso al panel' })).toBeVisible();
});
