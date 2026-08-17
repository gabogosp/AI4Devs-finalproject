import { test, expect } from '@playwright/test';

/**
 * AC-2 / AC-7 / AC-8 sobre el servidor real de producción.
 *
 * Todas las aserciones van contra el **body de la respuesta HTTP**, no contra el
 * DOM hidratado: un buscador no ejecuta la hidratación, así que probar el DOM
 * daría verde aunque el contenido llegara sólo por JavaScript.
 */
test('la ficha se renderiza en el servidor con su contenido y JSON-LD', async ({
  page,
}) => {
  const res = await page.goto('/productos/heladera-exhibidora');

  expect(res).not.toBeNull();
  expect(res!.status()).toBe(200);

  const html = await res!.text();
  expect(html).toContain('Heladera exhibidora');
  expect(html).toContain('Refrigeración');
  expect(html).toContain('12.500'); // precio formateado, no centavos
  expect(html).not.toContain('1250000');
  expect(html).toContain('application/ld+json');
  expect(html).toContain('https://schema.org/InStock');
});

test('un slug inexistente responde 404 real, no un 200 vacío', async ({ page }) => {
  const res = await page.goto('/productos/no-existe-jamas');

  expect(res).not.toBeNull();
  // Si esto fuera 200, Google indexaría una página de error como si fuera
  // contenido válido (AC-7/AC-8). Un draft o archivado llega acá igual: el
  // backend devuelve el mismo 404 uniforme, sin filtrar que el producto existe.
  expect(res!.status()).toBe(404);
  expect(await res!.text()).toContain('No encontramos este producto');
});

test('un producto sin stock se muestra pero no ofrece comprar (AC-4)', async ({
  page,
}) => {
  const res = await page.goto('/productos/taladro-percutor');

  expect(res!.status()).toBe(200);
  const html = await res!.text();
  expect(html).toContain('Taladro percutor');
  expect(html).toContain('Sin stock');
  expect(html).toContain('https://schema.org/OutOfStock');
  expect(html).toContain('wa.me');
  expect(html).not.toContain('Agregar al carrito');
});
