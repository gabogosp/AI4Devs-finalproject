import { createServer } from 'node:http';

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

const ID_TO_SLUG = new Map([
  [PRODUCT_ID, 'heladera-exhibidora'],
  [MUTABLE_ID, 'ventilador-de-techo'],
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

/** Estado en memoria: se muta con los PATCH del panel, como haría la API real. */
let products = initialCatalog();

/** Vista admin del mismo producto (el panel consume otro DTO). */
function adminProduct(slug) {
  const p = products.get(slug);
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
    products = initialCatalog();
    return json(res, 200, { ok: true });
  }

  // Ficha pública por slug (AC-1/AC-7/AC-8): 404 uniforme para lo no publicado.
  const publicMatch = path.match(/^\/v1\/products\/([^/]+)$/);
  if (req.method === 'GET' && publicMatch) {
    const product = products.get(decodeURIComponent(publicMatch[1]));
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
    const product = products.get(slug);
    // La mutación se refleja en la ficha pública desde el próximo GET: es lo
    // que permite probar que la invalidación —y no un TTL— hizo el trabajo.
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
