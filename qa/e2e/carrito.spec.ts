import { test, expect, type Page } from '@playwright/test';
import { seedCarrito, STOCK_INVARIANTE, type SeedCarrito } from '../support/seed-carrito';
import { adminAuth } from '../support/admin-auth';
import { apiCall } from '../support/api';

/**
 * TC-720..TC-725 y TC-731 — el carrito **en el navegador** (US-007, Layer 3).
 *
 * Estos escenarios son de QA y no del dev: recorren la UI real contra la API real
 * con datos sembrados por la API, así que prueban el acuerdo entre las tres capas.
 * Los unit/component del carrito los escribió el FE por TDD (§2.1) y no se repiten
 * acá.
 *
 * Selectores por **rol y nombre accesible**, nunca CSS ni índices; las esperas
 * asertan el estado siguiente y no hay un solo `waitForTimeout`
 * (`playwright-stability` §Selectors + §Auto-waiting).
 */

let seed: SeedCarrito;

test.beforeAll(async () => {
  seed = await seedCarrito();
});

/** Agrega desde la ficha pública, que es el camino del comprador (AC-1). */
async function agregarDesdeLaFicha(page: Page, slug: string): Promise<void> {
  await page.goto(`/productos/${slug}`);
  await page.getByRole('button', { name: /agregar al carrito/i }).click();
  // El mini-cart confirma sin redirigir: esperar por él es esperar el efecto, no
  // un tiempo.
  await expect(page.getByRole('status')).toContainText(/agregaste/i);
}

const filaDe = (page: Page, nombre: string) =>
  page.getByRole('listitem').filter({ hasText: nombre });

test.describe('TC-720/721/722 — recorrido y persistencia', () => {
  test('TC-720: agregar desde la ficha, ver la línea, editar la cantidad y quitar', async ({
    page,
  }) => {
    await agregarDesdeLaFicha(page, seed.mixtoA.slug);

    await page.goto('/carrito');
    const fila = filaDe(page, seed.mixtoA.name);
    await expect(fila).toBeVisible();

    // El precio unitario y el subtotal se muestran (AC-1). El importe se compara
    // en pesos, que es lo que la persona lee: el contrato viaja en centavos.
    const enPesos = Math.round(seed.mixtoA.price_ars_cents / 100).toLocaleString('es-AR');
    await expect(fila).toContainText(enPesos);

    // Editar con el stepper (AC-2): el total se recalcula contra el servidor.
    await fila.getByRole('button', { name: /sumar una unidad/i }).click();
    await expect(fila.getByRole('spinbutton')).toHaveValue('2');
    const dobleEnPesos = Math.round(
      (seed.mixtoA.price_ars_cents * 2) / 100,
    ).toLocaleString('es-AR');
    await expect(page.getByRole('region', { name: /resumen/i })).toContainText(
      dobleEnPesos,
    );

    // Quitar (AC-3): la línea desaparece. Se asserta sobre ESA fila y no sobre el
    // total de `listitem` de la página: el nav de rubros del layout también son
    // `<li>`, así que contar todos mide otra cosa.
    await fila.getByRole('button', { name: /quitar/i }).click();
    await expect(fila).toHaveCount(0);
  });

  test('TC-721: el carrito se recupera en un contexto NUEVO, sin cuenta (AC-4)', async ({
    page,
    browser,
  }) => {
    await agregarDesdeLaFicha(page, seed.mixtoB.slug);
    await page.goto('/carrito');
    await expect(filaDe(page, seed.mixtoB.name)).toBeVisible();

    // «Cerrar el navegador y volver»: sólo sobreviven las cookies persistentes.
    const estado = await page.context().storageState();
    const otro = await browser.newContext({ storageState: estado });
    const otraPagina = await otro.newPage();
    await otraPagina.goto('/carrito');

    // Sin haber creado cuenta: la identidad es la cookie del carrito.
    await expect(filaDe(otraPagina, seed.mixtoB.name)).toBeVisible();
    await otro.close();
  });

  test('TC-722: el carrito vacío invita a seguir comprando, con salida al catálogo (AC-7)', async ({
    page,
  }) => {
    await page.goto('/carrito');

    await expect(
      page.getByRole('heading', { name: /carrito está vacío/i }),
    ).toBeVisible();
    // AC-7 pide la invitación, no sólo la ausencia de ítems: tiene que haber
    // una salida navegable al catálogo.
    const salida = page.getByRole('link', { name: /ver rubros/i });
    await expect(salida).toBeVisible();
    await salida.click();
    await expect(page).toHaveURL(/\/categorias/);
  });
});

test.describe('TC-723/724/725 — los tres avisos', () => {
  test('TC-723: el stepper no deja superar el stock y muestra el motivo (AC-5)', async ({
    page,
  }) => {
    await agregarDesdeLaFicha(page, seed.stockTres.slug);
    await page.goto('/carrito');
    const fila = filaDe(page, seed.stockTres.name);

    const sumar = fila.getByRole('button', { name: /sumar una unidad/i });
    for (let i = 1; i < STOCK_INVARIANTE; i += 1) {
      await sumar.click();
      await expect(fila.getByRole('spinbutton')).toHaveValue(String(i + 1));
    }

    // En el tope el control se apaga: el límite se respeta en el cliente, no sólo
    // se rechaza en el servidor.
    await expect(sumar).toBeDisabled();
    await expect(fila.getByRole('spinbutton')).toHaveAttribute(
      'aria-valuemax',
      String(STOCK_INVARIANTE),
    );
  });

  test('TC-724: la línea despublicada en vuelo se marca y no ofrece camino al pago (AC-6)', async ({
    page,
  }) => {
    await agregarDesdeLaFicha(page, seed.paraDespublicar.slug);

    // Se despublica **por la API real**, con el carrito ya armado: es el caso que
    // le pasa al comprador que dejó el carrito abierto.
    const token = await adminAuth();
    await apiCall(
      `/v1/admin/products/${seed.paraDespublicar.id}`,
      'PATCH',
      token,
      { status: 'archived' },
    );

    await page.goto('/carrito');
    const fila = filaDe(page, seed.paraDespublicar.name);

    // El motivo va en TEXTO (el color no puede ser el único portador) y la línea
    // NO se borra sola.
    await expect(fila).toContainText(/ya no está disponible/i);
    await expect(page.getByRole('button', { name: /ir al pago/i })).toBeDisabled();
    await expect(page.getByRole('region', { name: /resumen/i })).toContainText(
      /no se pueden comprar/i,
    );
  });

  test('TC-725: el importe mostrado es el vigente y el cambio queda avisado (AC-9)', async ({
    page,
  }) => {
    await agregarDesdeLaFicha(page, seed.paraCambiarPrecio.slug);

    const nuevoPrecio = seed.paraCambiarPrecio.price_ars_cents + 150000;
    const token = await adminAuth();
    await apiCall(
      `/v1/admin/products/${seed.paraCambiarPrecio.id}`,
      'PATCH',
      token,
      { price_ars_cents: nuevoPrecio },
    );

    await page.goto('/carrito');
    const fila = filaDe(page, seed.paraCambiarPrecio.name);

    // Se muestra el precio NUEVO (el carrito no cachea) y el cambio se avisa: ni
    // el precio viejo congelado ni un cambio silencioso.
    await expect(fila).toContainText(
      Math.round(nuevoPrecio / 100).toLocaleString('es-AR'),
    );
    await expect(fila).toContainText(/cambió de/i);
  });
});

test.describe('TC-731 — teclado y anuncio del total', () => {
  test('TC-731: stepper y quitar se operan sólo con teclado, y el total se anuncia', async ({
    page,
  }) => {
    await agregarDesdeLaFicha(page, seed.mixtoA.slug);
    await page.goto('/carrito');
    const fila = filaDe(page, seed.mixtoA.name);
    await expect(fila).toBeVisible();

    // Se tabula hasta el control contando los focusables que lo preceden, nunca
    // con un presupuesto fijo de `Tab` (lección del recorrido de US-002).
    const sumar = fila.getByRole('button', { name: /sumar una unidad/i });
    await page.keyboard.press('Tab');
    for (let i = 0; i < 40 && !(await sumar.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(sumar).toBeFocused();

    // Foco VISIBLE: un foco alcanzable pero invisible no sirve para navegar.
    const contorno = await sumar.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle}|${s.boxShadow}`;
    });
    expect(contorno).not.toBe('none|none');

    await page.keyboard.press('Enter');
    await expect(fila.getByRole('spinbutton')).toHaveValue('2');

    // El total nuevo tiene que quedar en una región VIVA, no sólo en el DOM: sin
    // eso, quien usa lector de pantalla no se entera de que cambió.
    const enPesos = Math.round(
      (seed.mixtoA.price_ars_cents * 2) / 100,
    ).toLocaleString('es-AR');
    await expect(page.locator('[aria-live="polite"]')).toContainText(enPesos);

    // Y quitar también se alcanza y opera con teclado.
    const quitar = fila.getByRole('button', { name: /quitar/i });
    for (let i = 0; i < 10 && !(await quitar.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(quitar).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(fila).toHaveCount(0);
  });
});
