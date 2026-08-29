import { test, expect } from '@playwright/test';

/**
 * ADR-0010: `/` dejó de ser la home del panel y pasó a ser la raíz pública.
 * Se asserta sobre el HTML del **servidor** (no el DOM hidratado), porque lo
 * que un buscador ve es esa respuesta.
 */
test('/ responde 200 y es la home pública, no el panel', async ({ page }) => {
  const res = await page.goto('/');

  expect(res).not.toBeNull();
  expect(res!.status()).toBe(200);

  const html = await res!.text();
  expect(html).not.toContain('Panel del dueño');
  expect(html).toContain('DSM Refrigeración y Ferretería');
});
