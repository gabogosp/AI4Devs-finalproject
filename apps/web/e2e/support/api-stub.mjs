import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * Stub del contrato para los E2E (design.md D10).
 *
 * Por qué existe: el fetch de la ficha ocurre **en el servidor** de Next, así
 * que `page.route` de Playwright —que intercepta en el browser— no lo ve. La
 * alternativa era levantar la API real con docker, pero eso vuelve el smoke
 * lento y no determinista, y la batería contra la API viva es de QA, no del dev.
 *
 * Sirve la superficie mínima: la ficha pública por slug y los endpoints admin
 * que usa el flujo del panel. Sin dependencias: `node:http` a secas.
 */
const PORT = Number(process.env.API_STUB_PORT ?? 4010);

const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
/** Producto exclusivo del spec de invalidación: aislarlo evita fallas cruzadas. */
const MUTABLE_ID = '33333333-3333-4333-8333-333333333333';

/** Producto del fixture de BROWSE mutable desde el panel (US-002 T7.4). */
const BROWSE_MUTABLE_ID = '44444444-4444-4444-8444-444444444444';

const ID_TO_SLUG = new Map([
  [PRODUCT_ID, 'heladera-exhibidora'],
  [MUTABLE_ID, 'ventilador-de-techo'],
  [BROWSE_MUTABLE_ID, 'compresor-invalidacion'],
]);

/** Catálogo inicial. `reset()` lo reconstruye entero (fixture limpio por corrida). */
const initialCatalog = () => new Map([
  [
    'heladera-exhibidora',
    {
      slug: 'heladera-exhibidora',
      sku: 'REF-001',
      name: 'Heladera exhibidora',
      description: 'Heladera de 400 litros para comercios.',
      price_ars_cents: 1250000,
      currency: 'ARS',
      image_url: null,
      in_stock: true,
      category: { name: 'Refrigeración', slug: 'refrigeracion' },
    },
  ],
  [
    'ventilador-de-techo',
    {
      slug: 'ventilador-de-techo',
      sku: 'VEN-020',
      name: 'Ventilador de techo',
      description: 'Ventilador de techo con tres velocidades.',
      price_ars_cents: 1250000,
      currency: 'ARS',
      image_url: null,
      in_stock: true,
      category: { name: 'Ventilación', slug: 'ventilacion' },
    },
  ],
  [
    'taladro-percutor',
    {
      slug: 'taladro-percutor',
      sku: 'FER-010',
      name: 'Taladro percutor',
      description: null,
      price_ars_cents: 480000,
      currency: 'ARS',
      image_url: null,
      in_stock: false,
      category: { name: 'Ferretería', slug: 'ferreteria' },
    },
  ],
]);

/**
 * Fixture del BROWSE (US-002), disjunto del de la PDP a propósito: con
 * `fullyParallel: true` los specs corren en workers distintos, y compartir
 * productos haría que el reset de uno le cambie los datos al otro.
 */
const CATALOG_PRODUCT_COUNT = 25;
const initialBrowseCatalog = () =>
  new Map(
    Array.from({ length: CATALOG_PRODUCT_COUNT }, (_, i) => {
      const n = i + 1;
      const slug = `compresor-e2e-${n}`;
      return [
        slug,
        {
          slug,
          sku: `CMP-${String(n).padStart(3, '0')}`,
          name: `Compresor E2E ${n}`,
          description: null,
          price_ars_cents: 100000 + n * 1000,
          currency: 'ARS',
          image_url: null,
          in_stock: n % 5 !== 0,
          category: { name: 'Compresores E2E', slug: 'compresores-e2e' },
        },
      ];
    }).concat([
      // Producto EXCLUSIVO del spec de invalidación, en su propia categoría:
      // el spec lo renombra, y si viviera en `compresores-e2e` el spec de SSR
      // —que asserta nombres ahí— lo vería renombrado a mitad de corrida.
      [
        'compresor-invalidacion',
        {
          slug: 'compresor-invalidacion',
          sku: 'CMP-INV',
          name: 'Compresor Invalidación',
          description: null,
          price_ars_cents: 777000,
          currency: 'ARS',
          image_url: null,
          in_stock: true,
          category: { name: 'Invalidación E2E', slug: 'invalidacion-e2e' },
        },
      ],
    ]),
  );

/** Árbol de dos niveles del fixture de browse. */
const CATEGORY_TREE = [
  {
    slug: 'climatizacion',
    name: 'Climatización',
    children: [{ slug: 'compresores-e2e', name: 'Compresores E2E' }],
  },
  { slug: 'vacia-e2e', name: 'Vacía E2E', children: [] },
  { slug: 'invalidacion-e2e', name: 'Invalidación E2E', children: [] },
];

const CATEGORY_BY_SLUG = new Map([
  ['climatizacion', { slug: 'climatizacion', name: 'Climatización', parent: null,
    children: [{ slug: 'compresores-e2e', name: 'Compresores E2E' }] }],
  ['compresores-e2e', { slug: 'compresores-e2e', name: 'Compresores E2E',
    parent: { slug: 'climatizacion', name: 'Climatización' }, children: [] }],
  ['vacia-e2e', { slug: 'vacia-e2e', name: 'Vacía E2E', parent: null, children: [] }],
  ['invalidacion-e2e', { slug: 'invalidacion-e2e', name: 'Invalidación E2E',
    parent: null, children: [] }],
]);

/** Estado en memoria: se muta con los PATCH del panel, como haría la API real. */
let products = initialCatalog();
let browseProducts = initialBrowseCatalog();

// --- Fixture de auth de cliente (US-014) ---------------------------------
//
// El journey de auth necesita un backend que emita cookies con los atributos
// REALES: la topología (T0.3) y AC-9 se prueban leyendo `context.cookies()`,
// no el DOM. Un stub que devolviera el token en el body probaría otra cosa.

const CUSTOMER_ID = '55555555-5555-4555-8555-555555555555';

const initialCustomers = () =>
  new Map([
    [
      'ana@example.com',
      {
        id: CUSTOMER_ID,
        email: 'ana@example.com',
        name: 'Ana Gómez',
        password: 'Contrasena-Valida-1',
        locked: false,
      },
    ],
    [
      'bloqueada@example.com',
      {
        id: '66666666-6666-4666-8666-666666666666',
        email: 'bloqueada@example.com',
        name: 'Cuenta Bloqueada',
        password: 'Contrasena-Valida-1',
        locked: true,
      },
    ],
  ]);

let customers = initialCustomers();
/** Tokens de reset emitidos: `token → { email, usado }`. */
let resetTokens = new Map();

const RESET_TOKEN_VALIDO = 'reset-token-valido';
const RESET_TOKEN_USADO = 'reset-token-usado';
const RESET_TOKEN_VENCIDO = 'reset-token-vencido';

const initialResetTokens = () =>
  new Map([
    [RESET_TOKEN_VALIDO, { email: 'ana@example.com', usado: false }],
    [RESET_TOKEN_USADO, { email: 'ana@example.com', usado: true }],
    [RESET_TOKEN_VENCIDO, { email: 'ana@example.com', vencido: true }],
  ]);

/** Sesiones vivas por token de acceso, para que `/auth/me` y logout sean reales. */
let sessions = new Map();
/**
 * Último token de reset **por email**, expuesto en `/__last-reset-token?email=`.
 *
 * Indexado por cuenta y no como un global de última escritura: con
 * `fullyParallel`, dos specs que piden reset al mismo tiempo se pisarían el
 * valor y el que leyera segundo usaría el token del otro. La carrera existía y
 * se manifestaba como un fallo intermitente.
 */
let ultimoResetToken = new Map();

/**
 * Vista pública del cliente tal como la declara el contrato: exactamente cinco
 * campos. Devolver menos hace que la validación Zod del frontend rechace la
 * respuesta —correctamente— y el journey falle por el stub, no por la app.
 */
const vistaPublica = (c) => ({
  id: c.id,
  email: c.email,
  name: c.name,
  phone: c.phone ?? null,
  created_at: c.created_at ?? '2026-01-01T00:00:00Z',
});

const nuevoToken = (prefijo) =>
  `${prefijo}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/**
 * El contrato declara `id` como **uuid**, así que un id con prefijo legible
 * (`cust-abc…`) hace que la validación Zod del frontend rechace la respuesta.
 * El stub tiene que respetar el contrato tanto como el backend real: si miente
 * en el formato, el journey falla por el stub y no por la app.
 */
const nuevoUuid = () => randomUUID();

/**
 * Emite las tres cookies con los atributos que el backend usa de verdad
 * (§7.4): `dsm_refresh` acotada a `/v1/auth` para que no viaje en cada
 * request al catálogo, y `dsm_csrf` **legible por JS** a propósito — es la
 * mitad del double-submit.
 */
function emitirSesion(res, customer) {
  const access = nuevoToken('access');
  const csrf = nuevoToken('csrf');
  sessions.set(access, { customerId: customer.id, csrf });
  res.setHeader('Set-Cookie', [
    `dsm_access=${access}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900`,
    `dsm_refresh=${nuevoToken('refresh')}; HttpOnly; SameSite=Lax; Path=/v1/auth; Max-Age=604800`,
    `dsm_csrf=${csrf}; SameSite=Lax; Path=/; Max-Age=900`,
  ]);
  return { access, csrf };
}

const leerCookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p.length === 2),
  );

/**
 * 401 **idéntico** para contraseña incorrecta, cuenta inexistente y cuenta
 * bloqueada (AC-5). Un solo helper para los tres: si cada caso armara su
 * respuesta, la divergencia se colaría en el primer cambio.
 */
const credencialesInvalidas = (res) =>
  problem(res, 401, 'dsm:auth/invalid-credentials', 'Unauthorized', {
    detail: 'Email o contraseña incorrectos',
  });

const problem = (res, status, type, title, extra = {}) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/problem+json');
  res.end(JSON.stringify({ type, title, status, ...extra }));
};

/** Log de requests: permite probar AC-7 contra lo que el servidor PIDIÓ. */
const requestLog = [];

/**
 * Productos publicados de una categoría. Un RUBRO **agrega** los de sus
 * subrubros directos; un SUBRUBRO lista sólo los propios (decisión D1 del
 * backend). Recorrer ambos niveles duplicaría cada ficha.
 */
function productsOfCategory(slug) {
  const cat = CATEGORY_BY_SLUG.get(slug);
  if (!cat) return null;
  const slugs = cat.children.length > 0 ? cat.children.map((c) => c.slug) : [slug];
  return [...browseProducts.values()].filter((p) => slugs.includes(p.category.slug));
}

/** Vista admin del mismo producto (el panel consume otro DTO). */
function adminProduct(slug) {
  // Busca en los dos fixtures: el panel opera sobre el catálogo completo, no
  // sólo sobre el de la PDP.
  const p = products.get(slug) ?? browseProducts.get(slug);
  const id = [...ID_TO_SLUG].find(([, s]) => s === slug)?.[0] ?? PRODUCT_ID;
  return {
    id,
    sku: p.sku,
    slug: p.slug,
    name: p.name,
    description_raw: p.description,
    price_ars_cents: p.price_ars_cents,
    stock: p.in_stock ? 5 : 0,
    status: 'published',
    category_id: CATEGORY_ID,
    image_url: p.image_url,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    // Igual que la API real: caché acotada (AC-9).
    'cache-control': 'public, max-age=60, stale-while-revalidate=30',
  });
  res.end(JSON.stringify(body));
};

const notFound = (res) =>
  json(res, 404, {
    type: 'dsm:catalog/not-found',
    title: 'No encontrado',
    status: 404,
    detail: 'El producto no existe',
  });

const notFoundCategory = (res) =>
  json(res, 404, {
    type: 'dsm:catalog/not-found',
    title: 'No encontrado',
    status: 404,
    detail: 'La categoría no existe',
  });

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (path === '/health') return json(res, 200, { ok: true });

  // Reset del estado: los E2E que mutan lo llaman al empezar, así cada corrida
  // parte del mismo punto y el spec es idempotente (playwright-stability).
  if (req.method === 'POST' && path === '/__reset') {
    // `scope` acota el reset. Sin él resetea todo, como antes: los specs de
    // US-003 que lo llaman sin scope siguen viendo el mismo comportamiento.
    const scope = url.searchParams.get('scope');
    if (scope === null || scope === 'pdp') products = initialCatalog();
    if (scope === null || scope === 'catalog') browseProducts = initialBrowseCatalog();
    // `auth` es su propio alcance: un spec de auth que resetea NO puede pisarle
    // el catálogo a un spec de PDP corriendo en paralelo (fullyParallel).
    // `auth` sólo se resetea si se pide EXPLÍCITAMENTE. El reset sin alcance
    // existe desde antes que auth y sus llamadores quieren decir "restaurá el
    // catálogo": si además borrara sesiones, un spec de catálogo desloguearía
    // al de auth corriendo en paralelo.
    if (scope === 'auth') {
      customers = initialCustomers();
      resetTokens = initialResetTokens();
      sessions = new Map();
      ultimoResetToken = new Map();
    }
    // El log NO se limpia acá a propósito: es diagnóstico append-only, no
    // estado del fixture. Si el reset lo borrara, un spec corriendo en paralelo
    // (fullyParallel) vaciaría el log de otro en medio de su aserción — una
    // carrera que se ve como "el servidor no pidió nada".
    return json(res, 200, { ok: true, scope: scope ?? 'all' });
  }

  // Log de requests recibidos: AC-7 se prueba contra lo que el servidor PIDIÓ,
  // no contando tarjetas en el DOM (contar pasaría igual si el server se
  // hubiera traído las 5.000).
  if (req.method === 'GET' && path === '/__requests') {
    return json(res, 200, requestLog);
  }

  // Diagnóstico para el E2E de recuperación: el token que el "backend" acaba de
  // emitir. Análoga a `/__requests`; no existe en el backend real.
  if (req.method === 'GET' && path === '/__last-reset-token') {
    const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
    return json(res, 200, { token: ultimoResetToken.get(email) ?? null });
  }

  // El log existe para afirmar QUÉ pidió el servidor de Next al renderizar el
  // catálogo (US-002 AC-7). Las llamadas de auth salen del navegador y son de
  // otra superficie: incluirlas ensucia esas aserciones con ruido de otro spec.
  if (req.method === 'GET' && path.startsWith('/v1/') && !path.startsWith('/v1/auth/')) {
    requestLog.push({ url: req.url, path, query: url.search });
  }

  // --- Superficie de auth de cliente (US-014) ---
  if (path.startsWith('/v1/auth/') || path === '/v1/auth/me') {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const cookies = leerCookies(req);

    // Header de fuerza para el 429: AC-10 necesita un 429 determinista, y
    // gatillarlo por volumen real haría el spec lento y flaky.
    if (req.headers['x-force-rate-limit'] === '1') {
      res.setHeader('Retry-After', '42');
      return problem(res, 429, 'dsm:auth/rate-limited', 'Too Many Requests', {
        detail: 'Demasiados intentos. Probá de nuevo en un rato.',
      });
    }

    if (req.method === 'POST' && path === '/v1/auth/register') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (customers.has(email)) {
        return problem(res, 409, 'dsm:auth/registration-failed', 'Conflict', {
          detail: 'No se pudo completar el registro',
        });
      }
      const customer = {
        id: nuevoUuid(),
        email,
        name: String(body.name ?? 'Cliente'),
        password: String(body.password ?? ''),
        locked: false,
      };
      customers.set(email, customer);
      emitirSesion(res, customer);
      return json(res, 201, { customer: vistaPublica(customer) });
    }

    if (req.method === 'POST' && path === '/v1/auth/login') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const customer = customers.get(email);
      // Los tres casos colapsan al mismo helper: es AC-5 por construcción.
      if (!customer || customer.locked || customer.password !== body.password) {
        return credencialesInvalidas(res);
      }
      emitirSesion(res, customer);
      return json(res, 200, { customer: vistaPublica(customer) });
    }

    // `refresh` y `logout` son escrituras autenticadas por cookie: exigen el
    // header CSRF (double-submit) y un Origin declarado.
    if (
      req.method === 'POST' &&
      (path === '/v1/auth/refresh' || path === '/v1/auth/logout')
    ) {
      const sesion = sessions.get(cookies.dsm_access);
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader || !req.headers.origin) {
        return problem(res, 403, 'dsm:auth/csrf-failed', 'Forbidden', {
          detail: 'Falta el token CSRF o el origen',
        });
      }
      if (!sesion || csrfHeader !== sesion.csrf) {
        return problem(res, 403, 'dsm:auth/csrf-failed', 'Forbidden', {
          detail: 'Token CSRF inválido',
        });
      }
      if (path === '/v1/auth/logout') {
        sessions.delete(cookies.dsm_access);
        res.setHeader('Set-Cookie', [
          'dsm_access=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
          'dsm_refresh=; HttpOnly; SameSite=Lax; Path=/v1/auth; Max-Age=0',
          'dsm_csrf=; SameSite=Lax; Path=/; Max-Age=0',
        ]);
        res.statusCode = 204;
        return res.end();
      }
      const customer = [...customers.values()].find(
        (c) => c.id === sesion.customerId,
      );
      emitirSesion(res, customer);
      return json(res, 200, { customer: vistaPublica(customer) });
    }

    if (req.method === 'GET' && path === '/v1/auth/me') {
      const sesion = sessions.get(cookies.dsm_access);
      if (!sesion) return credencialesInvalidas(res);
      const customer = [...customers.values()].find(
        (c) => c.id === sesion.customerId,
      );
      // `me` devuelve el cliente PLANO, no envuelto: es la forma del contrato.
      return json(res, 200, vistaPublica(customer));
    }

    if (req.method === 'POST' && path === '/v1/auth/password-reset/request') {
      const email = String(body.email ?? '').trim().toLowerCase();
      // Sólo se emite token si la cuenta existe — pero la RESPUESTA es la misma
      // en ambos casos, que es donde vive la anti-enumeración (AC-11).
      if (customers.has(email)) {
        const token = nuevoToken('reset');
        resetTokens.set(token, { email, usado: false });
        ultimoResetToken.set(email, token);
      }
      res.statusCode = 202;
      return res.end();
    }

    if (req.method === 'POST' && path === '/v1/auth/password-reset/confirm') {
      const registro = resetTokens.get(String(body.token ?? ''));
      // Vencido, usado e inexistente dan el MISMO 400: distinguirlos diría si
      // el token existió alguna vez.
      if (!registro || registro.usado || registro.vencido) {
        return problem(res, 400, 'dsm:auth/invalid-reset-token', 'Bad Request', {
          detail: 'El enlace no es válido o ya se usó. Pedí uno nuevo.',
        });
      }
      const customer = customers.get(registro.email);
      customer.password = String(body.password ?? '');
      registro.usado = true;
      sessions = new Map(); // confirmar revoca TODAS las sesiones
      return json(res, 200, { data: { ok: true } });
    }

    return notFound(res);
  }

  // --- Superficie pública de categorías (US-002) ---
  if (req.method === 'GET' && path === '/v1/categories') {
    return json(res, 200, { data: CATEGORY_TREE });
  }

  const categoryMatch = path.match(/^\/v1\/categories\/([^/]+)$/);
  if (req.method === 'GET' && categoryMatch) {
    const cat = CATEGORY_BY_SLUG.get(decodeURIComponent(categoryMatch[1]));
    return cat ? json(res, 200, cat) : notFoundCategory(res);
  }

  const catProductsMatch = path.match(/^\/v1\/categories\/([^/]+)\/products$/);
  if (req.method === 'GET' && catProductsMatch) {
    const all = productsOfCategory(decodeURIComponent(catProductsMatch[1]));
    if (all === null) return notFoundCategory(res);

    const limit = Number(url.searchParams.get('limit') ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isInteger(offset) || offset < 0) {
      return json(res, 422, {
        type: 'dsm:catalog/validation',
        title: 'Parámetros inválidos',
        status: 422,
        detail: 'limit debe estar entre 1 y 100; offset debe ser >= 0',
      });
    }

    return json(res, 200, {
      data: all.slice(offset, offset + limit).map(({ slug, name, price_ars_cents,
        currency, image_url, in_stock }) => ({ slug, name, price_ars_cents,
        currency, image_url, in_stock })),
      pagination: { limit, offset, total: all.length },
    });
  }

  // Ficha pública por slug (AC-1/AC-7/AC-8): 404 uniforme para lo no publicado.
  const publicMatch = path.match(/^\/v1\/products\/([^/]+)$/);
  if (req.method === 'GET' && publicMatch) {
    const slug = decodeURIComponent(publicMatch[1]);
    const product = products.get(slug) ?? browseProducts.get(slug);
    return product ? json(res, 200, product) : notFound(res);
  }

  // --- Superficie admin usada por el panel ---
  if (req.method === 'POST' && path === '/v1/admin/auth/login') {
    return json(res, 200, { token: 'jwt-admin' });
  }
  if (req.method === 'GET' && path === '/v1/admin/categories') {
    return json(res, 200, [
      {
        id: CATEGORY_ID,
        slug: 'refrigeracion',
        name: 'Refrigeración',
        parent_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
  }
  if (req.method === 'GET' && path === '/v1/admin/products') {
    return json(res, 200, {
      data: [adminProduct('heladera-exhibidora')],
      pagination: { limit: 20, offset: 0, total: 1 },
    });
  }
  const adminMatch = path.match(/^\/v1\/admin\/products\/([0-9a-f-]+)$/);
  if (req.method === 'GET' && adminMatch && ID_TO_SLUG.has(adminMatch[1])) {
    return json(res, 200, adminProduct(ID_TO_SLUG.get(adminMatch[1])));
  }
  if (req.method === 'PATCH' && adminMatch && ID_TO_SLUG.has(adminMatch[1])) {
    const slug = ID_TO_SLUG.get(adminMatch[1]);
    const body = await readBody(req);
    const product = products.get(slug) ?? browseProducts.get(slug);
    // La mutación se refleja en la ficha pública y en el listado desde el
    // próximo GET: es lo que permite probar que la invalidación —y no un
    // TTL— hizo el trabajo.
    if (typeof body.price_ars_cents === 'number') {
      product.price_ars_cents = body.price_ars_cents;
    }
    if (typeof body.name === 'string') product.name = body.name;
    return json(res, 200, adminProduct(slug));
  }

  return notFound(res);
});

server.listen(PORT, () => {
  console.log(`[api-stub] escuchando en http://localhost:${PORT}`);
});
