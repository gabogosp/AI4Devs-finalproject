import { expect, test } from '@playwright/test';
import { catalogoParaCheckout, crearOrdenEnEstado } from '../support/seed-ordenes';

/**
 * QA-026-E2E-1/2 (US-026, `qa-plan.md` §5) — navegador real contra el home
 * construido, mismo patrón que el resto de `qa/e2e/` (sin stubs). El
 * catálogo vacío (E2E-2) va PRIMERO, antes de que cualquier otro test
 * seed productos — mismo criterio de orden narrativo que
 * `destacados.feature` (aceptación BDD, PR #148): ambos endpoints son
 * agregados globales sin scoping.
 */

test('QA-026-E2E-2 — catálogo vacío: ninguna sección de destacados se renderiza', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DSM Refrigeración y Ferretería' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Novedades' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Más vendidos' })).toHaveCount(0);
});

test('QA-026-E2E-1 — el home real muestra Novedades y Más vendidos, cada card linkea a su ficha', async ({
  page,
}) => {
  // El poll de ISR de abajo puede tardar hasta ~90s (revalidate 60s + margen
  // de regeneración) — el timeout default de 30s del test lo cortaría a
  // mitad de camino.
  test.setTimeout(150_000);

  // Novedades: alcanza con que el producto esté publicado.
  const { productos: nuevos } = await catalogoParaCheckout(1);
  const nuevo = nuevos[0]!;

  // Más vendidos: además necesita una venta confirmada (ídem BDD, target
  // 'new' alcanza — el WHERE del BE incluye new/preparing/ready/delivered).
  const { token, productos: vendidos } = await catalogoParaCheckout(1);
  const vendido = vendidos[0]!;
  await crearOrdenEnEstado('new', {
    adminToken: token,
    items: [
      {
        slug: vendido.slug,
        quantity: 3,
        priceArsCents: vendido.price_ars_cents,
        productName: vendido.name,
      },
    ],
  });

  // El home es ISR (`next build` lo prerenderea `○ Static`, revalidate 60s —
  // hereda el `maxAge:60` del BE, D-QA3). La 1ra visita a `/` de este
  // proceso (test QA-026-E2E-2, catálogo vacío) ya gastó el único "trigger"
  // de regeneración en background con el catálogo todavía vacío; una
  // navegación inmediata después de sembrar cae dentro de esa ventana
  // "fresh" y sirve el mismo HTML viejo (`x-nextjs-cache: HIT`, no `STALE`).
  // No es un bug — es exactamente el trade-off de `maxAge:60,swr:30` que
  // decidimos en el diseño — así que el test poll-ea re-navegando hasta que
  // la regeneración en background la ponga al día, en vez de asumir un
  // fetch SSR por request.
  // El poll espera al producto SEMBRADO por este test puntual, no sólo a
  // que la sección exista — corridas de debug previas contra este mismo
  // proceso ya dejaron otros productos en "Novedades", así que la sección
  // puede estar visible en un HTML todavía viejo (`x-nextjs-cache: HIT`)
  // sin que la regeneración en background haya terminado de incorporar
  // ESTE producto.
  const seccionNovedades = page.getByRole('region', { name: 'Novedades' });
  const linkNuevo = seccionNovedades.getByRole('link', { name: new RegExp(nuevo.name) });
  await expect(async () => {
    await page.goto('/');
    await expect(linkNuevo).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 90_000, intervals: [2000] });
  await expect(linkNuevo).toHaveAttribute('href', `/productos/${nuevo.slug}`);

  const seccionMasVendidos = page.getByRole('region', { name: 'Más vendidos' });
  const linkVendido = seccionMasVendidos.getByRole('link', { name: new RegExp(vendido.name) });
  await expect(async () => {
    await page.goto('/');
    await expect(linkVendido).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 90_000, intervals: [2000] });
  await expect(linkVendido).toHaveAttribute('href', `/productos/${vendido.slug}`);

  // La ficha real existe del otro lado del link (AC-1/AC-2 completos, no
  // sólo el href bien armado).
  await linkNuevo.click();
  await expect(page).toHaveURL(new RegExp(`/productos/${nuevo.slug}$`));
});
