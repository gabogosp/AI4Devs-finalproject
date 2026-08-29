import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { Given, When, Then } from '@cucumber/cucumber';
import { seedCategorias, type SeedCategorias } from '../../support/seed-categorias';
import type { CatalogWorld } from './world';

/**
 * Timeout por paso para los que tocan red o UI. El default de Cucumber son 5 s,
 * corto para un SSR en frío que además hace dos llamadas a la API: el paso
 * agotaba antes que el locator, y el error resultante ("function timed out")
 * no dice nada sobre qué no apareció.
 */
const PASO = { timeout: 30_000 };

/** Formato de precio de la app: `$ 12.500`, en pesos y sin centavos. */
function pesos(centavos: number): string {
  return new Intl.NumberFormat('es-AR').format(Math.round(centavos / 100));
}

function seed(world: CatalogWorld): SeedCategorias {
  const s = world.state.seed as SeedCategorias | undefined;
  assert.ok(s, 'el escenario no sembró el árbol de categorías');
  return s;
}

Given(
  'un árbol de categorías sembrado con productos en todos sus estados',
  { timeout: 120_000 },
  async function (this: CatalogWorld) {
    // Vía la API real (nunca INSERT): respeta la FSM draft→published→archived y
    // la derivación server-side del slug. El seed usa un prefijo único por
    // corrida, así que cada escenario estrena slugs — y por lo tanto ninguna
    // página quedó cacheada de una corrida anterior.
    this.state.seed = await seedCategorias();
  },
);

When('un visitante abre el rubro por su slug', PASO, async function (this: CatalogWorld) {
  await this.visitar(`/categorias/${seed(this).rubro.slug}`);
});

When('un visitante abre el subrubro por su slug', PASO, async function (this: CatalogWorld) {
  await this.visitar(`/categorias/${seed(this).subrubro.slug}`);
});

When('un visitante abre la categoría vacía', PASO, async function (this: CatalogWorld) {
  await this.visitar(`/categorias/${seed(this).vacia.slug}`);
});

Then('ve el subrubro entre las opciones de navegación', PASO, async function (this: CatalogWorld) {
  const { subrubro } = seed(this);
  await expect(
    this.page!.getByRole('link', { name: subrubro.name }).first(),
  ).toBeVisible();
});

Then('ve productos publicados en la grilla', PASO, async function (this: CatalogWorld) {
  const { publicados } = seed(this);
  // Se asserta que aparezca ALGUNO de los sembrados, no uno en particular: el
  // backend ordena por `name ASC` y los nombres llevan sufijo numérico, así que
  // el orden alfabético NO coincide con el de creación —"-11" va antes que
  // "-9"—. Fijar `publicados[0]` ataba el test a una suposición de orden que no
  // es parte de ningún AC, y fallaba por eso y no por el comportamiento.
  const html = await this.page!.content();
  const visibles = publicados.filter((p) => html.includes(p.name));
  assert.ok(
    visibles.length > 0,
    'la grilla no muestra ninguno de los productos publicados sembrados',
  );
  this.state.visiblesEnGrilla = visibles;
});

Then(
  'entre ellos está un producto que cuelga del subrubro',
  PASO,
  async function (this: CatalogWorld) {
    // Los `publicados` cuelgan TODOS del subrubro: que alguno aparezca en la
    // página del rubro es exactamente la agregación D-1 del backend. Si el
    // rubro listara sólo lo propio, acá no habría ninguno.
    const visibles = this.state.visiblesEnGrilla as unknown[] | undefined;
    assert.ok(
      visibles && visibles.length > 0,
      'el rubro no agregó ningún producto de su subrubro (regla D-1 del backend)',
    );
  },
);

Then(
  'no ve el producto que cuelga directamente del rubro padre',
  PASO,
  async function (this: CatalogWorld) {
    const { enRubro } = seed(this);
    const html = await this.page!.content();
    assert.ok(
      !html.includes(enRubro.name),
      `el subrubro listó "${enRubro.name}", que pertenece al rubro padre: la agregación hereda hacia abajo cuando no debería`,
    );
  },
);

Then('puede volver al rubro padre desde la navegación', PASO, async function (this: CatalogWorld) {
  const { rubro } = seed(this);
  const alPadre = this.page!.getByRole('link', { name: rubro.name }).first();
  await expect(alPadre).toBeVisible();

  await alPadre.click();
  await expect(this.page!).toHaveURL(new RegExp(`/categorias/${rubro.slug}$`));
});

Then(
  'cada producto de la grilla muestra su nombre y su precio en pesos',
  PASO,
  async function (this: CatalogWorld) {
    const { publicados } = seed(this);
    const html = await this.page!.content();
    const primero = publicados.find((p) => html.includes(p.name));
    assert.ok(primero, 'ningún producto sembrado aparece en la grilla');

    await expect(
      this.page!.getByRole('link', { name: new RegExp(primero.name) }).first(),
    ).toBeVisible();
    // El precio viaja en centavos por contrato: mostrarlo crudo sería un error
    // de un factor 100, y es el tipo de bug que un assert por nombre no ve.
    await expect(
      this.page!.getByText(pesos(primero.price_ars_cents), { exact: false }).first(),
    ).toBeVisible();
  },
);

Then('la grilla ofrece una segunda página', PASO, async function (this: CatalogWorld) {
  const paginacion = this.page!.getByRole('navigation', { name: 'Paginación' });
  await expect(paginacion).toBeVisible();
  // Acotado a la paginación y con `exact`: sin las dos cosas, `name: '2'`
  // matchea por substring y captura los 22 productos cuyo nombre contiene "2".
  await expect(paginacion.getByRole('link', { name: '2', exact: true })).toBeVisible();
});

When('el visitante avanza a la segunda página', PASO, async function (this: CatalogWorld) {
  this.state.pagina1 = await this.page!.content();
  await this.page!
    .getByRole('navigation', { name: 'Paginación' })
    .getByRole('link', { name: '2', exact: true })
    .click();
  await this.page!.waitForURL(/[?&]page=2/);
});

Then('ve productos distintos a los de la primera', PASO, async function (this: CatalogWorld) {
  const { publicados } = seed(this);
  const pagina1 = this.state.pagina1 as string;
  const pagina2 = await this.page!.content();

  // El seed crea PAGE_SIZE+1 publicados con stock: el sobrante cae en la
  // página 2. Si ambas páginas trajeran lo mismo, el offset no se aplicó.
  const enPagina2 = publicados.filter((p) => pagina2.includes(p.name));
  assert.ok(enPagina2.length > 0, 'la página 2 no trajo ningún producto sembrado');
  assert.ok(
    enPagina2.some((p) => !pagina1.includes(p.name)),
    'la página 2 repite exactamente los productos de la página 1: el offset no se está aplicando',
  );
});

Then(
  've el producto sin stock con su indicador de falta de stock',
  PASO,
  async function (this: CatalogWorld) {
    const { sinStock, subrubro } = seed(this);

    // Se recorren las páginas hasta encontrarlo en vez de asumir en cuál cae:
    // el backend ordena por `name ASC` y el sufijo numérico de los nombres hace
    // que el orden alfabético no coincida con el de creación. Atarlo a "está en
    // la página 2" hacía fallar el test por una suposición que no es un AC.
    let encontrado = false;
    for (const pagina of [1, 2]) {
      const url =
        pagina === 1
          ? `/categorias/${subrubro.slug}`
          : `/categorias/${subrubro.slug}?page=${pagina}`;
      await this.visitar(url);
      if ((await this.page!.content()).includes(sinStock.name)) {
        encontrado = true;
        break;
      }
    }
    assert.ok(encontrado, 'el producto sin stock no aparece en ninguna página de la grilla');
    // El indicador es TEXTO, no sólo color: el color no es portador único de
    // significado (WCAG 2.1 AA).
    await expect(this.page!.getByText('Sin stock').first()).toBeVisible();
  },
);

Then('la grilla no ofrece ninguna acción de compra', PASO, async function (this: CatalogWorld) {
  // AC-5 es por producto (US-002 AC-5: "un producto sin stock... no ofrece la
  // acción"), no por grilla entera: desde US-007 T3.5 la grilla SÍ tiene
  // "Agregar" en las cards con stock (OQ-FE-2 resuelta como «sí»). Lo que
  // AC-5 prohíbe es que la CARD DE ESTE producto la tenga — el nombre
  // accesible del botón incluye el producto (`Agregar ${item.name}`)
  // justamente para poder distinguirlas en una grilla con muchos "Agregar".
  const { sinStock } = seed(this);
  await expect(
    this.page!.getByRole('button', { name: `Agregar ${sinStock.name}`, exact: true }),
  ).toHaveCount(0);
});

Then('ve un mensaje de que todavía no hay productos', PASO, async function (this: CatalogWorld) {
  await expect(this.page!.getByText(/Todavía no hay productos/i)).toBeVisible();
});

Then(
  'puede navegar hacia otros rubros desde esa misma página',
  PASO,
  async function (this: CatalogWorld) {
    // Un vacío mudo dejaría al cliente sin salida: el criterio de AC-6 es que
    // pueda seguir navegando, no sólo que se le avise.
    await expect(this.page!.getByRole('link', { name: /Ver todos los rubros/i })).toBeVisible();
  },
);

When('hace clic en el primer producto de la grilla', PASO, async function (this: CatalogWorld) {
  const { publicados } = seed(this);
  const html = await this.page!.content();
  // El que esté visible, no el primero creado: el orden de la grilla es
  // alfabético y no coincide con el de creación.
  const primero = publicados.find((p) => html.includes(p.name));
  assert.ok(primero, 'ningún producto sembrado aparece en la grilla');
  this.state.productoElegido = primero;

  await this.page!.getByRole('link', { name: new RegExp(primero.name) }).first().click();
});

Then('llega a la ficha de ese producto', PASO, async function (this: CatalogWorld) {
  const elegido = this.state.productoElegido as SeedCategorias['publicados'][number];

  // Si la grilla enlazara por un identificador que la ficha no resuelve, acá
  // habría 404 en vez de la ficha. Es el único punto donde esa divergencia
  // aparece (OQ-QA-2).
  await expect(this.page!).toHaveURL(new RegExp(`/productos/${elegido.slug}$`));
});

Then(
  'la ficha muestra el mismo nombre y el mismo precio que la grilla',
  PASO,
  async function (this: CatalogWorld) {
    const elegido = this.state.productoElegido as SeedCategorias['publicados'][number];

    await expect(
      this.page!.getByRole('heading', { level: 1, name: new RegExp(elegido.name) }),
    ).toBeVisible();
    await expect(
      this.page!.getByText(pesos(elegido.price_ars_cents), { exact: false }).first(),
    ).toBeVisible();
  },
);

Given(
  'que un visitante ya vio la categoría sin el producto nuevo',
  PASO,
  async function (this: CatalogWorld) {
    const { subrubro, draft } = seed(this);

    // Poblar la caché del listado SIN el producto: así el assert final sólo
    // puede pasar si la invalidación corrió, no porque nunca hubo caché.
    await this.visitar(`/categorias/${subrubro.slug}`);
    const html = await this.page!.content();
    assert.ok(
      !html.includes(draft.name),
      'el producto en borrador ya aparecía en la grilla: el filtro `published` está roto (AC-8)',
    );
  },
);

When('el dueño publica ese producto desde el panel', PASO, async function (this: CatalogWorld) {
  const { draft } = seed(this);

  // Por la UI del panel a propósito: ése es el camino que dispara la Server
  // Action de invalidación. Publicar por API directa no invalida nada, y el
  // escenario daría verde sin probar el circuito.
  // El formulario del panel pide el **bootstrap token**, no el JWT: la ruta
  // `/v1/admin/auth/login` intercambia uno por otro. Rellenarlo con
  // `this.token` —que ya es el JWT que devolvió `adminAuth()`— hacía fallar el
  // login en silencio y el paso agotaba sin decir por qué.
  const bootstrap = process.env.ADMIN_BOOTSTRAP_TOKEN;
  assert.ok(
    bootstrap,
    'ADMIN_BOOTSTRAP_TOKEN ausente: el panel no puede loguearse y este escenario no probaría el circuito real',
  );

  await this.visitar('/admin/acceso');
  await this.page!.getByLabel(/Token de acceso/).fill(bootstrap);
  await this.page!.getByRole('button', { name: 'Entrar' }).click();
  await this.page!.waitForURL(/\/admin\/productos/);

  await this.visitar(`/admin/productos/${draft.id}`);
  await this.page!.getByRole('button', { name: /Publicar/i }).click();
});

Then(
  'el producto aparece en la categoría sin esperar el vencimiento de la caché',
  { timeout: 60_000 },
  async function (this: CatalogWorld) {
    const { subrubro, draft } = seed(this);

    // `expect.poll` y no una espera fija: la invalidación es fire-and-forget
    // —la mutación ya fue confirmada por el backend— así que la recarga puede
    // ganarle por milisegundos.
    //
    // No debilita la aserción: la caché del listado dura 1 h y el poll agota en
    // 30 s, dos órdenes de magnitud menos, así que si el producto aparece sólo
    // puede ser por la invalidación y nunca por un TTL vencido. Si no corre, el
    // poll agota y el escenario FALLA.
    //
    // 30 y no 10: en la corrida completa la base ya trae los productos que
    // sembraron los escenarios previos, el SSR del listado tarda más y 10 s
    // quedaba corto — el escenario pasaba aislado y fallaba en suite, que es la
    // firma de un umbral apretado y no de un defecto.
    // Se recorren AMBAS páginas: el subrubro ya tiene 22 publicados, así que el
    // recién publicado cae en la página 1 o en la 2 según su lugar en el orden
    // alfabético. Mirar sólo la 1 hacía fallar el escenario por dónde ordena el
    // backend y no por si la invalidación corrió.
    await expect
      .poll(
        async () => {
          let html = '';
          for (const url of [
            `/categorias/${subrubro.slug}`,
            `/categorias/${subrubro.slug}?page=2`,
          ]) {
            await this.visitar(url);
            html += await this.page!.content();
          }
          return html;
        },
        { timeout: 30_000, intervals: [500, 1000, 2000, 3000, 5000] },
      )
      .toContain(draft.name);
  },
);
