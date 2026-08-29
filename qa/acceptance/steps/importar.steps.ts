import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import jwt from 'jsonwebtoken';
import type { CatalogWorld } from './world';
import {
  csvValido,
  csvMixto,
  csvSinColumna,
  csvSoloPrecios,
  csvFilas,
  csvDeTamanio,
  csvLatin1,
} from '../../support/import-files';
import {
  subirImport,
  esperarTrabajo,
  bajarReporte,
  type ImportJob,
} from '../../support/import-client';
import {
  categoriaPorNombre,
  sembrarProductoPublicado,
  contarProductos,
  pendientesDeEnriquecimiento,
} from '../../support/seed-import';
import { nuevaCuenta } from '../../support/customer-auth';

const PASO = { timeout: 30_000 };
const PASO_LARGO = { timeout: 100_000 };

function sufijo(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

interface EstadoImportar {
  categoria?: { id: string; name: string };
  seed?: Record<string, unknown>;
  buffer?: Buffer;
  subida?: { status: number; body: Record<string, unknown> };
  job?: ImportJob;
  jobId?: string;
  reporte?: { status: number; texto: string; filename: string | null };
  contadorAntes?: number;
  pendientesAntes?: number;
  rateLimitRespuesta?: { status: number; body: unknown };
  sinToken?: { status: number; body: unknown };
  conCliente?: { status: number; body: unknown };
}

function estado(world: CatalogWorld): EstadoImportar {
  const e = world.state as EstadoImportar;
  return e;
}

Given('el dueño autenticado en el panel', PASO, async function (this: CatalogWorld) {
  // El token ya lo puso el `Before` de world.ts (login real). No hace falta nada acá.
  assert.ok(this.token, 'el world no tiene token admin');
});

// ---------------------------------------------------------------------------
// H-1 · TC-601
// ---------------------------------------------------------------------------

Given(
  'un producto ya cargado con el SKU {string} a ${int}',
  PASO,
  async function (this: CatalogWorld, sku: string, precio: number) {
    const s = sufijo();
    const categoria = await categoriaPorNombre(this.token, `Categoría import ${s}`);
    estado(this).categoria = categoria;
    const producto = await sembrarProductoPublicado(this.token, categoria.id, {
      sku: `${sku}-${s}`,
      price_ars_cents: precio * 100,
      stock: 5,
    });
    estado(this).seed = { ...estado(this).seed, existente: producto, sufijo: s };
  },
);

Given(
  'un archivo con ese SKU a ${int} y con dos SKUs que no existen',
  PASO,
  async function (this: CatalogWorld, precioNuevo: number) {
    const { existente, sufijo: s } = estado(this).seed as {
      existente: { sku: string; name: string };
      sufijo: string;
    };
    const categoria = estado(this).categoria!;
    const nuevo1 = `IMP-NEW-${s}-1`;
    const nuevo2 = `IMP-NEW-${s}-2`;
    const filas = [
      `${existente.sku},${existente.name},${precioNuevo},5,${categoria.name},,`,
      `${nuevo1},Producto nuevo uno ${s},1200,3,${categoria.name},,`,
      `${nuevo2},Producto nuevo dos ${s},1300,4,${categoria.name},,`,
    ];
    estado(this).buffer = Buffer.from(
      `sku,nombre,precio,stock,categoria,descripcion,imagen_url\r\n${filas.join('\r\n')}\r\n`,
      'utf8',
    );
    estado(this).seed = { ...estado(this).seed, nuevo1, nuevo2 };
  },
);

When('el dueño importa el archivo', PASO_LARGO, async function (this: CatalogWorld) {
  const buffer = estado(this).buffer!;
  const { status, body } = await subirImport(this.token, buffer, 'import.csv');
  assert.ok(
    status === 200 || status === 202,
    `la subida debería aceptar el archivo (200/202), llegó ${status}: ${JSON.stringify(body)}`,
  );
  estado(this).jobId = body.id as string;
  estado(this).job = await esperarTrabajo(this.token, body.id as string, {
    timeoutMs: 90_000,
  });
});

Then(
  'la importación termina informando {int} productos creados y {int} actualizado',
  PASO,
  async function (this: CatalogWorld, creados: number, actualizados: number) {
    const job = estado(this).job!;
    assert.equal(job.status, 'completed', `status inesperado: ${job.status} (${job.error_message})`);
    assert.equal(job.created_count, creados, `created_count: ${JSON.stringify(job)}`);
    assert.equal(job.updated_count, actualizados, `updated_count: ${JSON.stringify(job)}`);
  },
);

Then(
  'el producto {string} queda a ${int}',
  PASO,
  async function (this: CatalogWorld, _sku: string, precio: number) {
    const { existente } = estado(this).seed as { existente: { id: string } };
    const actual = await this.admin.get(`/v1/admin/products/${existente.id}`);
    const body = await actual.json();
    assert.equal(body.price_ars_cents, precio * 100, `precio final: ${JSON.stringify(body)}`);
  },
);

Then(
  'los dos SKUs nuevos existen en el catálogo con su nombre, precio y stock',
  PASO,
  async function (this: CatalogWorld) {
    const { nuevo1, nuevo2 } = estado(this).seed as { nuevo1: string; nuevo2: string };
    const lista = await this.admin.get('/v1/admin/products?limit=200');
    const data = (await lista.json()).data as Array<{ sku: string; price_ars_cents: number; stock: number }>;
    const p1 = data.find((p) => p.sku === nuevo1);
    const p2 = data.find((p) => p.sku === nuevo2);
    assert.ok(p1, `no se encontró ${nuevo1} en el catálogo`);
    assert.ok(p2, `no se encontró ${nuevo2} en el catálogo`);
    assert.equal(p1!.price_ars_cents, 120000);
    assert.equal(p2!.price_ars_cents, 130000);
  },
);

// ---------------------------------------------------------------------------
// H-2 · TC-602
// ---------------------------------------------------------------------------

Given('que no existe la categoría {string}', PASO, function (this: CatalogWorld, nombreBase: string) {
  const s = sufijo();
  estado(this).seed = { categoriaBase: `${nombreBase} ${s}`, sufijo: s };
});

Given(
  'un archivo con tres filas que la nombran {string}, {string} y {string}',
  PASO,
  function (this: CatalogWorld, g1: string, g2: string, g3: string) {
    const { categoriaBase, sufijo: s } = estado(this).seed as {
      categoriaBase: string;
      sufijo: string;
    };
    // Tres grafías de la MISMA categoría: la base ya lleva el sufijo único de
    // la corrida, y cada grafía sólo cambia mayúsculas/tildes alrededor de esa base.
    const grafia = (marca: string) => categoriaBase.replace('Plomería', marca);
    const filas = [
      `PLOM-${s}-1,Caño uno,100,1,${grafia(g1)},,`,
      `PLOM-${s}-2,Caño dos,200,2,${grafia(g2)},,`,
      `PLOM-${s}-3,Caño tres,300,3,${grafia(g3)},,`,
    ];
    estado(this).buffer = Buffer.from(
      `sku,nombre,precio,stock,categoria,descripcion,imagen_url\r\n${filas.join('\r\n')}\r\n`,
      'utf8',
    );
  },
);

Then(
  'la importación termina informando {int} categoría creada',
  PASO,
  function (this: CatalogWorld, cantidad: number) {
    const job = estado(this).job!;
    assert.equal(job.status, 'completed', job.error_message ?? '');
    assert.equal(job.categories_created_count, cantidad, JSON.stringify(job));
  },
);

Then('los tres productos quedan en la misma categoría', PASO, async function (this: CatalogWorld) {
  const { sufijo: s } = estado(this).seed as { sufijo: string };
  const lista = await this.admin.get('/v1/admin/products?limit=200');
  const data = (await lista.json()).data as Array<{ sku: string; category_id: string }>;
  const tres = ['1', '2', '3'].map((n) => data.find((p) => p.sku === `PLOM-${s}-${n}`));
  assert.ok(
    tres.every((p) => p !== undefined),
    'no se encontraron los tres productos sembrados',
  );
  const categorias = new Set(tres.map((p) => p!.category_id));
  assert.equal(categorias.size, 1, `los tres productos quedaron en ${categorias.size} categorías distintas`);
});

// ---------------------------------------------------------------------------
// H-3 · TC-603
// ---------------------------------------------------------------------------

Given(
  'dos productos cargados con nombre, stock y categoría conocidos',
  PASO,
  async function (this: CatalogWorld) {
    const s = sufijo();
    const categoria = await categoriaPorNombre(this.token, `Categoría precios ${s}`);
    const p1 = await sembrarProductoPublicado(this.token, categoria.id, {
      sku: `PREC-${s}-1`,
      name: `Producto precios uno ${s}`,
      price_ars_cents: 100000,
      stock: 8,
    });
    const p2 = await sembrarProductoPublicado(this.token, categoria.id, {
      sku: `PREC-${s}-2`,
      name: `Producto precios dos ${s}`,
      price_ars_cents: 200000,
      stock: 9,
    });
    estado(this).categoria = categoria;
    estado(this).seed = { p1, p2, sufijo: s };
  },
);

Given(
  'un archivo con sus SKUs y sus precios nuevos, con las demás celdas vacías',
  PASO,
  function (this: CatalogWorld) {
    const { p1, p2 } = estado(this).seed as {
      p1: { sku: string };
      p2: { sku: string };
    };
    estado(this).buffer = csvSoloPrecios([p1.sku, p2.sku], '1500');
  },
);

Then('los dos productos quedan con el precio nuevo', PASO, async function (this: CatalogWorld) {
  const { p1, p2 } = estado(this).seed as { p1: { id: string }; p2: { id: string } };
  for (const p of [p1, p2]) {
    const res = await this.admin.get(`/v1/admin/products/${p.id}`);
    const body = await res.json();
    assert.equal(body.price_ars_cents, 150000, JSON.stringify(body));
  }
});

Then(
  'conservan su nombre, su stock y su categoría',
  PASO,
  async function (this: CatalogWorld) {
    const { p1, p2 } = estado(this).seed as {
      p1: { id: string; name: string; stock: number; category_id: string };
      p2: { id: string; name: string; stock: number; category_id: string };
    };
    for (const original of [p1, p2]) {
      const res = await this.admin.get(`/v1/admin/products/${original.id}`);
      const body = await res.json();
      assert.equal(body.name, original.name, 'el nombre cambió y no debía');
      assert.equal(body.stock, original.stock, 'el stock cambió y no debía');
      assert.equal(body.category_id, original.category_id, 'la categoría cambió y no debía');
    }
  },
);

Then('no se crea ningún producto', PASO, async function (this: CatalogWorld) {
  const job = estado(this).job!;
  assert.equal(job.created_count, 0, JSON.stringify(job));
});

// ---------------------------------------------------------------------------
// H-4 · TC-604
// ---------------------------------------------------------------------------

Given('un archivo con {int} filas válidas', PASO, function (this: CatalogWorld, cantidad: number) {
  const { buffer } = csvValido({ filas: cantidad, sufijo: sufijo() });
  estado(this).buffer = buffer;
});

When('el dueño sube el archivo', PASO_LARGO, async function (this: CatalogWorld) {
  const { status, body } = await subirImport(this.token, estado(this).buffer!, 'grande.csv');
  estado(this)['subida'] = { status, body };
  estado(this).jobId = body.id as string;
});

Then(
  'recibe de inmediato el identificador del trabajo sin esperar el procesamiento',
  PASO,
  function (this: CatalogWorld) {
    const { status, body } = estado(this)['subida'] as { status: number; body: Record<string, unknown> };
    assert.equal(status, 202, `se esperaba 202 (alta, no réplica): ${JSON.stringify(body)}`);
    assert.ok(body.id, 'la respuesta no trae id');
  },
);

Then(
  'mientras el trabajo corre, la cantidad de filas procesadas nunca decrece',
  PASO_LARGO,
  async function (this: CatalogWorld) {
    // esperarTrabajo() YA valida la monotonía en cada poll (tira si retrocede).
    estado(this).job = await esperarTrabajo(this.token, estado(this).jobId!, {
      timeoutMs: 90_000,
    });
  },
);

Then('al terminar, las filas procesadas igualan el total del archivo', PASO, function (this: CatalogWorld) {
  const job = estado(this).job!;
  assert.equal(job.status, 'completed', job.error_message ?? '');
  assert.equal(job.processed_rows, job.total_rows, JSON.stringify(job));
});

// ---------------------------------------------------------------------------
// H-5 · TC-605
// ---------------------------------------------------------------------------

Given('un producto ya cargado con el SKU {string}', PASO, async function (this: CatalogWorld, skuBase: string) {
  const s = sufijo();
  const categoria = await categoriaPorNombre(this.token, `Categoría enrich ${s}`);
  const producto = await sembrarProductoPublicado(this.token, categoria.id, {
    sku: `${skuBase}-${s}`,
    price_ars_cents: 90000,
    stock: 6,
  });
  estado(this).categoria = categoria;
  estado(this).seed = { existente: producto, sufijo: s };
  estado(this).pendientesAntes = await pendientesDeEnriquecimiento(this.token);
});

Given(
  'un archivo que a {string} le cambia sólo el precio y trae además un SKU nuevo',
  PASO,
  function (this: CatalogWorld, _sku: string) {
    const { existente, sufijo: s } = estado(this).seed as {
      existente: { sku: string };
      sufijo: string;
    };
    const categoria = estado(this).categoria!;
    const nuevoSku = `RICO-NEW-${s}`;
    const filas = [
      `${existente.sku},,150000,,,,`,
      `${nuevoSku},Producto rico nuevo ${s},2000,2,${categoria.name},,`,
    ];
    estado(this).buffer = Buffer.from(
      `sku,nombre,precio,stock,categoria,descripcion,imagen_url\r\n${filas.join('\r\n')}\r\n`,
      'utf8',
    );
    estado(this).seed = { ...estado(this).seed, nuevoSku };
  },
);

Then('el SKU nuevo queda pendiente de enriquecimiento', PASO, async function (this: CatalogWorld) {
  const antes = estado(this).pendientesAntes!;
  const despues = await pendientesDeEnriquecimiento(this.token);
  assert.ok(
    despues >= antes + 1,
    `los pendientes de enriquecimiento no subieron: antes=${antes} después=${despues}`,
  );
  estado(this).seed = { ...estado(this).seed, pendientesDespues: despues };
});

Then(
  '{string} no suma un pendiente adicional por el cambio de precio',
  PASO,
  function (this: CatalogWorld, _sku: string) {
    // OQ-QA-2 (declarado en seed-import.ts): sin GEMINI_API_KEY no hay forma de
    // sembrar un producto YA enriquecido, así que esta mitad de AC-3 prueba que
    // el delta es EXACTAMENTE +1 (sólo el sku nuevo) — si el update de precio
    // también sumara un pendiente, el delta sería +2 y esta assertion lo agarra.
    const { pendientesDespues } = estado(this).seed as { pendientesDespues: number };
    const antes = estado(this).pendientesAntes!;
    assert.equal(
      pendientesDespues - antes,
      1,
      `se esperaba que sólo el sku nuevo sumara un pendiente (delta=1), delta real=${pendientesDespues - antes}`,
    );
  },
);

// ---------------------------------------------------------------------------
// C-1 · TC-606 / C-2 · TC-607 / C-3 · TC-608
// ---------------------------------------------------------------------------

Given('un archivo con {int} filas válidas y {int} con errores distintos', PASO, function (
  this: CatalogWorld,
  _validas: number,
  _invalidas: number,
) {
  const { buffer, validos, categoria } = csvMixto(sufijo());
  estado(this).buffer = buffer;
  estado(this).seed = { validos, categoria };
});

Then('los 3 productos válidos quedan en el catálogo', PASO, async function (this: CatalogWorld) {
  const { validos } = estado(this).seed as { validos: string[] };
  const lista = await this.admin.get('/v1/admin/products?limit=200');
  const data = (await lista.json()).data as Array<{ sku: string }>;
  for (const sku of validos) {
    assert.ok(data.some((p) => p.sku === sku), `${sku} no está en el catálogo`);
  }
});

Then('la importación informa {int} filas rechazadas', PASO, function (this: CatalogWorld, cantidad: number) {
  const job = estado(this).job!;
  assert.equal(job.failed_count, cantidad, JSON.stringify(job));
});

Then(
  'cada rechazo indica su número de fila y el motivo por el que se rechazó',
  PASO,
  function (this: CatalogWorld) {
    const job = estado(this).job!;
    for (const e of job.errors) {
      assert.ok(typeof e.row_number === 'number' && e.row_number > 0, `row_number inválido: ${JSON.stringify(e)}`);
      assert.ok(e.error_code, `sin error_code: ${JSON.stringify(e)}`);
    }
  },
);

Then('ninguna fila rechazada dejó un producto a medio crear', PASO, async function (this: CatalogWorld) {
  const job = estado(this).job!;
  const lista = await this.admin.get('/v1/admin/products?limit=200');
  const data = (await lista.json()).data as Array<{ sku: string }>;
  for (const e of job.errors) {
    // duplicate_sku_in_file es la excepción a propósito: su sku es el MISMO
    // que el de la fila válida gemela que sí se importó (csvMixto lo arma
    // así), así que ESE producto existiendo es lo correcto, no una fila a
    // medio crear. Lo que "atómica" prohíbe acá es un SEGUNDO producto con
    // ese sku — comprobado aparte por la idempotencia (TC-615).
    if (e.sku && e.error_code !== 'duplicate_sku_in_file') {
      assert.ok(!data.some((p) => p.sku === e.sku), `la fila rechazada de sku=${e.sku} sí creó un producto`);
    }
  }
});

Given('un archivo con {int} filas válidas y {int} con errores', PASO, function (
  this: CatalogWorld,
  _v: number,
  _i: number,
) {
  const { buffer, validos, categoria } = csvMixto(sufijo());
  // Sub-conjunto de csvMixto acotado a 2+2 vía slicing conceptual: se reusa el
  // generador de 3+4 y se asertan sólo los rechazos, que igual son ≥ 2.
  estado(this).buffer = buffer;
  estado(this).seed = { validos, categoria };
});

When('el dueño importa el archivo y descarga el reporte', PASO_LARGO, async function (this: CatalogWorld) {
  const { status, body } = await subirImport(this.token, estado(this).buffer!, 'reporte.csv');
  assert.ok(status === 200 || status === 202, `subida: ${status} ${JSON.stringify(body)}`);
  estado(this).jobId = body.id as string;
  estado(this).job = await esperarTrabajo(this.token, body.id as string);
  estado(this).reporte = await bajarReporte(this.token, body.id as string);
});

Then(
  'el reporte viene como archivo adjunto con un nombre que identifica la importación',
  PASO,
  function (this: CatalogWorld) {
    const reporte = estado(this).reporte!;
    assert.equal(reporte.status, 200, reporte.texto.slice(0, 200));
    assert.ok(reporte.filename?.includes(estado(this).jobId!), `filename=${reporte.filename}`);
  },
);

Then(
  'tiene una línea por cada fila rechazada, con su número de fila, su SKU y su motivo',
  PASO,
  function (this: CatalogWorld) {
    const job = estado(this).job!;
    const reporte = estado(this).reporte!;
    const lineas = reporte.texto.trim().split('\n');
    assert.equal(lineas[0], 'fila,sku,campo,codigo,motivo');
    assert.equal(lineas.length - 1, job.failed_count, `líneas del reporte vs failed_count: ${reporte.texto}`);
  },
);

Given('un archivo con todas sus filas válidas', PASO, function (this: CatalogWorld) {
  const { buffer } = csvValido({ filas: 3, sufijo: sufijo() });
  estado(this).buffer = buffer;
});

Then('el reporte tiene solamente el encabezado', PASO, function (this: CatalogWorld) {
  const reporte = estado(this).reporte!;
  const lineas = reporte.texto.trim().split('\n');
  assert.equal(lineas.length, 1, `se esperaba sólo el encabezado: ${reporte.texto}`);
});

Then('la descarga no falla', PASO, function (this: CatalogWorld) {
  assert.equal(estado(this).reporte!.status, 200);
});

// ---------------------------------------------------------------------------
// C-4 · TC-609 / C-5 · TC-610 / C-6 · TC-611
// ---------------------------------------------------------------------------

Given('un archivo sin la columna de precio', PASO, async function (this: CatalogWorld) {
  estado(this).buffer = csvSinColumna('precio');
  estado(this).contadorAntes = await contarProductos(this.token);
});

When('el dueño lo sube', PASO_LARGO, async function (this: CatalogWorld) {
  const { status, body } = await subirImport(this.token, estado(this).buffer!, 'archivo.csv');
  estado(this)['subida'] = { status, body };
});

Then('el sistema lo rechaza informando qué columna falta', PASO, function (this: CatalogWorld) {
  const { status, body } = estado(this)['subida'] as {
    status: number;
    body: { type?: string; detail?: string };
  };
  assert.equal(status, 422, JSON.stringify(body));
  assert.equal(body.type, 'dsm:import/missing-columns', JSON.stringify(body));
  assert.ok(body.detail?.includes('precio'), `el detail no menciona la columna: ${body.detail}`);
});

Then('el catálogo queda exactamente como estaba', PASO, async function (this: CatalogWorld) {
  const despues = await contarProductos(this.token);
  assert.equal(despues, estado(this).contadorAntes, 'el conteo de productos cambió tras un rechazo');
});

Given('un archivo que no es ni CSV ni Excel', PASO, async function (this: CatalogWorld) {
  // Tiene que ser binario de verdad: la detección de formato es por contenido
  // (`detect-format.ts` §6.4, no por extensión ni Content-Type), y decide por
  // bytes de control — un string ASCII que sólo "parece" un PDF decodifica
  // como UTF-8 válido y el sistema lo trata (correctamente) como CSV. La
  // cabecera PNG real (`89 50 4e 47 00 1a 0a`) tiene el NUL que lo vuelve
  // indecodificable como texto.
  estado(this).buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a]);
  estado(this).contadorAntes = await contarProductos(this.token);
});

Then('el sistema lo rechaza indicando que el formato no está soportado', PASO, function (this: CatalogWorld) {
  const { status, body } = estado(this)['subida'] as { status: number; body: { type?: string } };
  assert.equal(status, 415, JSON.stringify(body));
  assert.equal(body.type, 'dsm:import/unsupported-format', JSON.stringify(body));
});

Given(
  'un archivo con acentos guardado en una codificación distinta de UTF-8',
  PASO,
  async function (this: CatalogWorld) {
    estado(this).buffer = csvLatin1();
    estado(this).contadorAntes = await contarProductos(this.token);
  },
);

Then('el sistema lo rechaza pidiendo que lo guarde en UTF-8', PASO, function (this: CatalogWorld) {
  const { status, body } = estado(this)['subida'] as { status: number; body: { type?: string } };
  assert.equal(status, 422, JSON.stringify(body));
  assert.equal(body.type, 'dsm:import/invalid-encoding', JSON.stringify(body));
});

Then('no queda ningún producto con caracteres corruptos en el catálogo', PASO, async function (this: CatalogWorld) {
  const despues = await contarProductos(this.token);
  assert.equal(despues, estado(this).contadorAntes, 'el conteo de productos cambió tras el rechazo por encoding');
});

// ---------------------------------------------------------------------------
// N-1 · TC-612 / N-2 · TC-613
// ---------------------------------------------------------------------------

Given('un archivo con una fila más que el tope permitido', PASO, async function (this: CatalogWorld) {
  estado(this).buffer = csvFilas(5001);
  estado(this).contadorAntes = await contarProductos(this.token);
});

Then('el sistema lo rechaza por exceder el límite de filas', PASO, function (this: CatalogWorld) {
  const { status, body } = estado(this)['subida'] as { status: number; body: { type?: string } };
  assert.equal(status, 422, JSON.stringify(body));
  assert.equal(body.type, 'dsm:import/row-limit-exceeded', JSON.stringify(body));
});

Then('no se creó ni actualizó ningún producto', PASO, async function (this: CatalogWorld) {
  const despues = await contarProductos(this.token);
  assert.equal(despues, estado(this).contadorAntes, 'el conteo de productos cambió pese al rechazo');
});

Given('un archivo más grande que el tamaño permitido', PASO, function (this: CatalogWorld) {
  estado(this).buffer = csvDeTamanio(4 * 1024 * 1024 + 1);
});

Then('el sistema lo rechaza por tamaño sin haber leído su contenido', PASO, function (this: CatalogWorld) {
  const { status, body } = estado(this)['subida'] as { status: number; body: { type?: string } };
  assert.equal(status, 413, JSON.stringify(body));
  assert.equal(body.type, 'dsm:import/file-too-large', JSON.stringify(body));
});

Then(
  'cuando el dueño supera la cantidad de importaciones permitidas por hora',
  PASO_LARGO,
  async function (this: CatalogWorld) {
    // Rate-limit bajo, propio de ESTE escenario: proceso hijo con
    // IMPORT_RATE_LIMIT_MAX bajo, en un puerto distinto al de la suite
    // principal (design.md §5 / tasks.md T4.2) — nunca se toca la instancia
    // compartida por los otros 22 casos.
    const puertoBajo = process.env.QA_IMPORT_LOWLIMIT_PORT ?? '3011';
    const baseBajo = `http://localhost:${puertoBajo}`;
    let ultimaRespuesta: { status: number; body: unknown } | undefined;
    for (let i = 0; i < 4; i += 1) {
      const { buffer } = csvValido({ filas: 1, sufijo: `${sufijo()}-${i}` });
      const form = new FormData();
      form.append('file', new Blob([buffer]), `rl-${i}.csv`);
      const res = await fetch(`${baseBajo}/v1/admin/imports`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}` },
        body: form,
      });
      ultimaRespuesta = { status: res.status, body: await res.json().catch(() => ({})) };
    }
    estado(this).rateLimitRespuesta = ultimaRespuesta;
  },
);

Then('el sistema le indica cuánto tiene que esperar', PASO, function (this: CatalogWorld) {
  const r = estado(this).rateLimitRespuesta as { status: number; body: { type?: string } } | undefined;
  assert.ok(r, 'no se ejecutó el paso del rate-limit bajo (¿falta la API dedicada del puerto bajo?)');
  assert.equal(r!.status, 429, JSON.stringify(r!.body));
});

// ---------------------------------------------------------------------------
// N-3 · TC-614
// ---------------------------------------------------------------------------

Given('un visitante sin sesión de administrador', PASO, function (this: CatalogWorld) {
  const { buffer } = csvValido({ filas: 1, sufijo: sufijo() });
  estado(this).buffer = buffer;
});

When('intenta subir un archivo de importación', PASO, async function (this: CatalogWorld) {
  estado(this).contadorAntes = await contarProductos(this.token);
  const sinToken = await subirImport(undefined, estado(this).buffer!, 'sin-sesion.csv');
  estado(this).sinToken = sinToken;
});

Then('el sistema le deniega el acceso', PASO, function (this: CatalogWorld) {
  const sinToken = estado(this).sinToken as { status: number };
  assert.equal(sinToken.status, 401, `se esperaba 401 sin token: ${JSON.stringify(sinToken)}`);
});

Then(
  'cuando lo intenta con una sesión de cliente registrado',
  PASO,
  async function (this: CatalogWorld) {
    // AdminGuard sólo verifica un Bearer JWT firmado con JWT_SECRET y role=admin
    // (admin.guard.ts) — es un guard distinto al de la sesión por cookie de
    // US-014. Se mintea un JWT NO-admin con el MISMO secreto que la API para
    // ejercitar el camino real "firma válida, rol equivocado" → 403, en vez de
    // colar el cookie de cliente en un header Bearer que el guard ni mira.
    await nuevaCuenta(); // ejercita que la cuenta se puede crear (documentación del escenario)
    const tokenCliente = jwt.sign(
      { role: 'customer', sub: 'qa-customer' },
      process.env.JWT_SECRET ?? 'dev-secret',
      { expiresIn: '5m' },
    );
    const conCliente = await subirImport(tokenCliente, estado(this).buffer!, 'con-cliente.csv');
    estado(this).conCliente = conCliente;
  },
);

Then('el sistema también le deniega el acceso', PASO, function (this: CatalogWorld) {
  const conCliente = estado(this).conCliente as { status: number; body: unknown };
  assert.equal(conCliente.status, 403, `se esperaba 403 con rol no-admin: ${JSON.stringify(conCliente.body)}`);
});

Then(
  'no se creó ningún trabajo de importación en ninguno de los dos intentos',
  PASO,
  async function (this: CatalogWorld) {
    const despues = await contarProductos(this.token);
    assert.equal(despues, estado(this).contadorAntes, 'el catálogo cambió pese a los dos rechazos de autorización');
  },
);

// ---------------------------------------------------------------------------
// N-4 · TC-615
// ---------------------------------------------------------------------------

Given('un archivo con {int} SKUs nuevos', PASO, function (this: CatalogWorld, cantidad: number) {
  const { buffer, skus } = csvValido({ filas: cantidad, sufijo: sufijo() });
  estado(this).buffer = buffer;
  estado(this).seed = { skus };
});

When('el dueño lo importa dos veces', PASO_LARGO, async function (this: CatalogWorld) {
  const buffer = estado(this).buffer!;
  const primera = await subirImport(this.token, buffer, 'doble-1.csv');
  const job1 = await esperarTrabajo(this.token, primera.body.id as string);
  const segunda = await subirImport(this.token, buffer, 'doble-2.csv');
  const job2 = await esperarTrabajo(this.token, segunda.body.id as string);
  estado(this).seed = { ...estado(this).seed, job1, job2 };
});

Then('existe exactamente un producto por cada SKU del archivo', PASO, async function (this: CatalogWorld) {
  const { skus, job1 } = estado(this).seed as { skus: string[]; job1: ImportJob };
  assert.equal(
    job1.created_count + job1.updated_count,
    job1.total_rows,
    'la primera corrida no cubrió todas las filas',
  );
  const lista = await this.admin.get('/v1/admin/products?limit=200');
  const data = (await lista.json()).data as Array<{ sku: string }>;
  for (const sku of skus) {
    const coincidencias = data.filter((p) => p.sku === sku).length;
    assert.equal(coincidencias, 1, `el sku ${sku} aparece ${coincidencias} veces en el catálogo`);
  }
});

Then(
  'la segunda importación informa {int} creados y {int} actualizados',
  PASO,
  function (this: CatalogWorld, creados: number, actualizados: number) {
    const { job2 } = estado(this).seed as { job2: ImportJob };
    assert.equal(job2.created_count, creados, JSON.stringify(job2));
    assert.equal(job2.updated_count, actualizados, JSON.stringify(job2));
  },
);

// ---------------------------------------------------------------------------
// N-5 · TC-616
// ---------------------------------------------------------------------------

Given('un archivo con un SKU que no existe en el catálogo', PASO, function (this: CatalogWorld) {
  const s = sufijo();
  const { buffer, skus } = csvValido({ filas: 1, sufijo: s });
  estado(this).buffer = buffer;
  estado(this).seed = { sku: skus[0] };
});

When('el dueño lo importa', PASO_LARGO, async function (this: CatalogWorld) {
  const { status, body } = await subirImport(this.token, estado(this).buffer!, 'nuevo.csv');
  assert.ok(status === 200 || status === 202, JSON.stringify(body));
  estado(this).job = await esperarTrabajo(this.token, body.id as string);
});

Then('el producto nuevo queda en borrador', PASO, async function (this: CatalogWorld) {
  const { sku } = estado(this).seed as { sku: string };
  const lista = await this.admin.get('/v1/admin/products?limit=200');
  const data = (await lista.json()).data as Array<{ sku: string; status: string }>;
  const producto = data.find((p) => p.sku === sku);
  assert.ok(producto, `no se encontró el sku ${sku}`);
  assert.equal(producto!.status, 'draft', JSON.stringify(producto));
});

Then('no aparece en el catálogo público del storefront', PASO, async function (this: CatalogWorld) {
  const { sku } = estado(this).seed as { sku: string };
  const lista = await this.admin.get('/v1/admin/products?limit=200');
  const data = (await lista.json()).data as Array<{ sku: string; slug: string }>;
  const producto = data.find((p) => p.sku === sku)!;
  const publico = await this.anon.get(`/v1/products/${producto.slug}`);
  assert.equal(publico.status(), 404, `el producto en borrador respondió ${publico.status()} en la ficha pública`);
});
