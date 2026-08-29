import { test, expect, type Page } from '@playwright/test';
import { csvMixto, csvFilas } from '../support/import-files';
import { sembrarProductoPublicado, categoriaPorNombre } from '../support/seed-import';
import { adminAuth } from '../support/admin-auth';

/**
 * TC-617..TC-620 — las cuatro costuras que un proceso aparte no puede ver
 * (`qa-plan.md` §5): el multipart REAL de un navegador, la descarga REAL de un
 * `Blob`, que el storefront SIRVA el precio nuevo tras un ajuste masivo, y que
 * un refresh en medio del proceso no pierda el trabajo.
 *
 * Las 16 afirmaciones API-level de `@importar` (Cucumber) ya cubren las 11 AC;
 * acá sólo lo que cruza browser + web + API + caché.
 *
 * **Estuvieron en `test.fixme` por un defecto real** confirmado con evidencia
 * (trace de Playwright + preflight CORS manual, no una corazonada): el
 * frontend manda `idempotency-key` en cada `POST /v1/admin/imports`
 * (`importsService.ts`, `api-standards` §10), pero `allowedHeaders` de
 * `apps/api/src/bootstrap.ts` no lo incluía. El navegador rechazaba el
 * preflight y el `POST` real nunca salía (`status: -1` en la traza) — el
 * import era **inalcanzable desde cualquier browser real**, aunque `curl`/una
 * llamada Node directa (sin CORS) funcionaran perfecto. Ningún test dev-owned
 * (RTL+MSW no exige CORS real) lo detectaba; es exactamente la costura que
 * este E2E existe para cubrir. Fix aplicado: `'idempotency-key'` sumado a
 * `allowedHeaders` (documentado en `docs/RUN-MVP.md` §US-006). Las
 * assertions de abajo no se tocaron para el fix: ya estaban escritas contra
 * el comportamiento correcto, sólo dejaron de estar en `fixme`.
 */

const BOOTSTRAP = process.env.ADMIN_BOOTSTRAP_TOKEN || 'qa-bootstrap';

function sufijo(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function login(page: Page): Promise<void> {
  await page.goto('/admin/acceso');
  await page.getByLabel(/Token de acceso/).fill(BOOTSTRAP);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/admin\/productos/);
}

test.describe('Importación masiva de inventario — E2E de navegador', () => {
  test('TC-617 — subida real en navegador muestra progreso y resultado', async ({ page }) => {
    await login(page);
    await page.goto('/admin/importar');

    const { buffer } = csvMixto(sufijo());

    await page
      .locator('#archivo-import')
      .setInputFiles({ name: 'mixto.csv', mimeType: 'text/csv', buffer });
    await page.getByRole('button', { name: 'Importar catálogo' }).click();

    // La URL pasa a /admin/importar/{id}: es la costura de deep-link de TC-620.
    await page.waitForURL(/\/admin\/importar\/[a-f0-9-]+$/);

    // "Importación terminada" con foco en el encabezado (a11y — TC-621 lo audita).
    await expect(
      page.getByRole('heading', { name: 'Importación terminada' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Importación terminada' })).toBeFocused();

    // Los cinco contadores del contrato viven en el <dl> del resumen
    // (ImportResult §dl); acotar la búsqueda a ese <dl> evita el choque con
    // "Filas rechazadas" del encabezado de la tabla de detalle más abajo
    // (`Detalle de las filas rechazadas`), que matchea por substring.
    const resumen = page.locator('dl');
    await expect(resumen.getByText('Productos creados').locator('..')).toContainText('3');
    await expect(resumen.getByText('Filas rechazadas').locator('..')).toContainText('4');

    // AC-9: aviso de borrador con su link al listado.
    await expect(page.getByText(/quedaron en/)).toContainText('borrador');
    await expect(page.getByRole('link', { name: 'listado de productos' })).toBeVisible();
  });

  test('TC-618 — la descarga del reporte trae el archivo con el nombre del servidor', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/admin/importar');

    const { buffer } = csvMixto(sufijo());
    await page
      .locator('#archivo-import')
      .setInputFiles({ name: 'con-rechazos.csv', mimeType: 'text/csv', buffer });
    await page.getByRole('button', { name: 'Importar catálogo' }).click();
    await page.waitForURL(/\/admin\/importar\/[a-f0-9-]+$/);
    await expect(
      page.getByRole('button', { name: /Descargar reporte de errores/ }),
    ).toBeVisible({ timeout: 30_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Descargar reporte de errores/ }).click(),
    ]);

    // El nombre lo decide el `Content-Disposition` del SERVIDOR, no un default
    // del navegador: es la parte que jsdom sólo puede espiar.
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const ruta = await download.path();
    expect(ruta).toBeTruthy();
    const fs = await import('node:fs/promises');
    const contenido = await fs.readFile(ruta!, 'utf8');
    // Al menos una de las 4 filas rechazadas de csvMixto está en el CSV.
    expect(contenido).toMatch(/missing_required|invalid_price|invalid_stock|duplicate_sku_in_file/);
  });

  test('TC-619 — el storefront sirve el precio nuevo tras el ajuste masivo', async ({
    page,
    request,
  }) => {
    // Se siembra un producto YA PUBLICADO (para que tenga ficha pública) por
    // API real — nunca SQL — y se lee su HTML servido con un contexto de red
    // aparte (`request`), sobre el HTML servido, como `pdp-ssr-seo.spec.ts`.
    const suf = sufijo();
    const token = await adminAuth();
    const categoria = await categoriaPorNombre(token, `Categoría ajuste ${suf}`);
    const producto = await sembrarProductoPublicado(token, categoria.id, {
      sku: `AJU-${suf}`,
      price_ars_cents: 100_000,
    });

    await login(page);
    await page.goto('/admin/importar');

    // Peso entero a propósito: `formatArs` redondea a pesos sin decimales
    // (design.md — moneda ARS "IVA incluido", sin centavos en ninguna
    // pantalla), así que un precio con centavos haría que el test dependa de
    // la regla de redondeo en vez de la costura de revalidación que quiere
    // ejercitar.
    const nuevoPrecio = '2500,00';
    const buffer = Buffer.from(
      `sku,nombre,precio,stock,categoria,descripcion,imagen_url\r\n${producto.sku},,${nuevoPrecio},,,,\r\n`,
      'utf8',
    );
    await page
      .locator('#archivo-import')
      .setInputFiles({ name: 'ajuste-precio.csv', mimeType: 'text/csv', buffer });
    await page.getByRole('button', { name: 'Importar catálogo' }).click();
    await page.waitForURL(/\/admin\/importar\/[a-f0-9-]+$/);
    await expect(
      page.getByRole('heading', { name: 'Importación terminada' }),
    ).toBeVisible({ timeout: 30_000 });

    // Si `revalidateCatalogSafely()` se desconectara, este `expect.poll` es el
    // único test del proyecto que se pone rojo.
    await expect
      .poll(
        async () => {
          const res = await request.get(`/productos/${producto.slug}`);
          return res.text();
        },
        { timeout: 15_000, intervals: [500, 1_000, 2_000] },
      )
      .toContain('2.500');
  });

  test('TC-620 — refrescar en medio del proceso no pierde el trabajo', async ({ page }) => {
    await login(page);
    await page.goto('/admin/importar');

    const buffer = csvFilas(5_000);
    await page
      .locator('#archivo-import')
      .setInputFiles({ name: 'grande.csv', mimeType: 'text/csv', buffer });
    await page.getByRole('button', { name: 'Importar catálogo' }).click();
    await page.waitForURL(/\/admin\/importar\/[a-f0-9-]+$/);

    // Todavía corriendo (5.000 filas no terminan en el instante del click).
    await expect(page.getByRole('heading', { name: 'Importando el catálogo' })).toBeVisible();

    const url = page.url();
    await page.reload();
    // El deep-link es la URL, no el estado de React: un refresh sigue el mismo trabajo.
    expect(page.url()).toBe(url);
    await expect(
      page.getByRole('heading', { name: /Importando el catálogo|Importación terminada/ }),
    ).toBeVisible({ timeout: 15_000 });

    // Un id inventado: ni existe ni se purgó de verdad, pero el mensaje es el mismo.
    // `.filter({ hasText })` acota al alert de la app: Next.js agrega su
    // propio `role="alert"` vacío (`__next-route-announcer__`) para anunciar
    // rutas, que matchea `getByRole('alert')` a secas (el filtro por `name`
    // de accesibilidad no matchea acá — el contenido con tilde alcanza igual
    // por texto plano).
    await page.goto('/admin/importar/00000000-0000-0000-0000-000000000000');
    await expect(
      page.getByRole('alert').filter({ hasText: 'no existe o ya se purgó' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importar un archivo' })).toBeVisible();
  });
});
