import { test, expect } from '@playwright/test';

/**
 * ADR-0010 / E2E §14: el panel no se indexa; la superficie pública sí.
 *
 * Se asserta sobre la **respuesta real del servidor de producción**, no sobre
 * `next.config.mjs`: un test que lee el config sólo prueba que alguien escribió
 * una línea, no que el header llegue al cliente.
 */
test('el panel responde con X-Robots-Tag noindex', async ({ page }) => {
  const res = await page.goto('/admin/acceso');

  expect(res).not.toBeNull();
  expect(res!.headers()['x-robots-tag']).toBe('noindex, nofollow');
});

test('la superficie pública NO lleva X-Robots-Tag', async ({ page }) => {
  const res = await page.goto('/');

  expect(res).not.toBeNull();
  expect(res!.headers()['x-robots-tag']).toBeUndefined();
});
