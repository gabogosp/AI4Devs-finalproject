import { expect, test } from '@playwright/test';

/**
 * US-007 T5.3 — el carrito no se indexa, y agregarlo al layout compartido no rompió
 * la indexación de lo que **sí** se indexa.
 *
 * El riesgo concreto: el badge del carrito es una isla cliente dentro del layout del
 * storefront. Si ese layout hubiera pasado a client-only, las páginas públicas
 * dejarían de traer su contenido en el HTML del servidor y el SEO de US-002/US-003
 * —que es un objetivo de negocio del PRD— se caería en silencio.
 */
test.describe('El carrito no se indexa y no rompe la indexación (T5.3)', () => {
  test('/carrito declara noindex', async ({ page }) => {
    const respuesta = await page.goto('/carrito');

    expect(respuesta?.status()).toBe(200);

    // Metadata API → `<meta name="robots">`. Se acepta cualquiera de las dos formas
    // (meta o header) porque las dos son válidas para un crawler.
    const meta = await page
      .locator('meta[name="robots"]')
      .getAttribute('content')
      .catch(() => null);
    const header = respuesta?.headers()['x-robots-tag'] ?? '';
    expect(`${meta ?? ''} ${header}`).toMatch(/noindex/i);
  });

  test('el carrito NO aparece en el sitemap', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();

    // Una URL personalizada en el sitemap es una invitación a indexarla.
    expect(xml).not.toContain('/carrito');
  });

  test('la home sigue trayendo su contenido en el HTML del SERVIDOR', async ({
    request,
  }) => {
    // `request` y no `page`: sin ejecutar JS, que es como la ve un crawler.
    const html = await (await request.get('/')).text();

    expect(html).toContain('DSM');
    // El nav de rubros es Server Component y es la prueba de que el layout no se
    // volvió client-only al montarle el badge.
    expect(html.toLowerCase()).toContain('rubro');
  });

  test('el badge del carrito llega en el HTML del servidor, sin número', async ({
    request,
  }) => {
    const html = await (await request.get('/')).text();

    // El enlace se renderiza en servidor (es parte del layout); lo que hidrata es
    // sólo la cantidad. Y en el HTML inicial NO puede haber un número: sería una
    // afirmación sobre un carrito que el servidor no leyó.
    expect(html).toContain('Carrito');
    const badge = html.match(/aria-label="Ver el carrito[^"]*"/)?.[0] ?? '';
    expect(badge).toBe('aria-label="Ver el carrito"');
  });

  test('una ficha pública sigue siendo indexable después de sumar el botón de agregar', async ({
    request,
  }) => {
    const html = await (await request.get('/productos/compresor-e2e-3')).text();

    expect(html).toContain('Compresor E2E 3');
    // El precio también: si la ficha hubiera pasado a client-only, el crawler
    // vería un cascarón.
    expect(html).toMatch(/\$/);
  });
});
