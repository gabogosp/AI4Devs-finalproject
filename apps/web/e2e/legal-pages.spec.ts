import { test, expect } from '@playwright/test';
import { LEGAL_ROUTES } from '../src/features/legal/routes';

/**
 * US-017 T5.1 — AC-1, AC-2, AC-3, AC-6 y AC-7 sobre el **HTML servido**.
 *
 * Es la mitad que un test de componente no puede probar: lo que verifica este spec es lo que
 * ve un crawler y lo que ve alguien con JavaScript deshabilitado. Para una página que existe
 * para cumplir una obligación de la Ley 25.326 y para ser indexada, eso **es** el requisito —
 * no un detalle de implementación.
 *
 * Las rutas se importan de `LEGAL_ROUTES` y no se escriben como literales: el guard de
 * `routes.test.ts` falla si el literal aparece fuera de ese módulo, y este spec no es la
 * excepción.
 */

const RUTAS = Object.values(LEGAL_ROUTES);

for (const ruta of RUTAS) {
  test(`${ruta} responde 200 en el HTML servido, con h1 y versión (AC-1, AC-2, AC-8)`, async ({
    page,
  }) => {
    const res = await page.goto(ruta);

    expect(res!.status()).toBe(200);
    const html = await res!.text();

    expect(html).toMatch(/<h1[^>]*>/);
    // La versión es la mitad visible de AC-8: lo que la persona acepta tiene que
    // poder leerse en la página, no vivir sólo en un atributo o en la orden.
    expect(html).toContain('Versión');
    // `<time datetime>` — la fecha legible por máquina, no sólo por humanos.
    //
    // El regex es case-INsensitive a propósito: React emite el atributo como
    // `dateTime` (camelCase) en el HTML servido, y no `datetime`. No es un bug —
    // los nombres de atributo son case-insensitive para el parser de HTML, así que
    // el navegador y el crawler lo leen igual. Lo anoto porque el unit test de T1.1
    // pasa con `datetime` en minúscula (jsdom normaliza al parsear) y el HTML crudo
    // no: quien vea la diferencia podría "arreglar" el componente sin necesidad.
    expect(html).toMatch(/<time[^>]+datetime=/i);
  });

  test(`${ruta} no tiene ningún enlace muerto en el HTML (AC-6)`, async ({
    page,
  }) => {
    const html = await (await page.goto(ruta))!.text();

    // Un enlace legal apuntando a `#` en producción es PEOR que no tenerlo: da
    // apariencia de cumplimiento. El mismo invariante que el footer custodia en
    // unit, verificado acá sobre lo que se sirve de verdad.
    expect(html).not.toMatch(/href="#"/);
  });
}

test('las dos páginas se sirven sin ninguna cookie de sesión (AC-7)', async ({
  browser,
}) => {
  // Contexto NUEVO y explícito: si el spec heredara el estado de otro, «sin iniciar
  // sesión» quedaría sin probar y no se notaría (`playwright-stability`).
  const contexto = await browser.newContext();
  const page = await contexto.newPage();

  try {
    for (const ruta of RUTAS) {
      const res = await page.goto(ruta);
      expect(res!.status()).toBe(200);
    }

    // Y las páginas tampoco DEJAN cookies: son estáticas y sin sesión en los dos
    // sentidos. Si mañana alguien mete analítica acá, esto se pone rojo — es el
    // complemento en runtime del guard estático de T4.2.
    expect(await contexto.cookies()).toHaveLength(0);
  } finally {
    await contexto.close();
  }
});

test('una página pública cualquiera enlaza los dos legales en su footer (AC-3)', async ({
  page,
}) => {
  const html = await (await page.goto('/'))!.text();

  for (const ruta of RUTAS) {
    expect(html).toContain(`href="${ruta}"`);
  }
  // Nombres accesibles distintos, servidos en el HTML (no agregados al hidratar).
  expect(html).toContain('Política de privacidad');
  expect(html).toContain('Términos y condiciones');
});

test('el sitemap incluye las dos URLs legales, absolutas (AC-2)', async ({
  request,
}) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();

  for (const ruta of RUTAS) {
    // Absolutas: un buscador descarta las relativas. Se busca `://…{ruta}<` para no
    // dar verde con una entrada relativa que contenga la ruta.
    expect(xml).toMatch(
      new RegExp(`<loc>https?://[^<]*${ruta.replace(/\//g, '\\/')}</loc>`),
    );
  }
});

test('el panel del dueño NO enlaza los legales en su chrome (ADR-0010)', async ({
  page,
}) => {
  // El footer es superficie PÚBLICA. Si apareciera en `(admin)`, significaría que
  // alguien lo montó en el layout raíz y no en el route group — el error de
  // namespace que ADR-0010 existe para evitar.
  const html = await (await page.goto('/admin/acceso'))!.text();

  expect(html).not.toContain('Política de privacidad');
  expect(html).not.toContain('Términos y condiciones');
});
