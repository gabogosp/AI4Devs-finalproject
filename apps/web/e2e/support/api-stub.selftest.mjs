/**
 * Self-test del stub de contrato. Levanta el stub en un puerto efímero,
 * ejercita cada semántica y sale distinto de 0 si alguna falla.
 *
 * Existe porque el stub es el "backend" contra el que corren los E2E: si el
 * stub miente, los E2E dan verde por la razón equivocada. Un stub sin tests es
 * un oráculo sin verificar.
 *
 * Uso: `node apps/web/e2e/support/api-stub.selftest.mjs`
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = 4099;
const BASE = `http://localhost:${PORT}`;
const stubPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'api-stub.mjs');

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const child = spawn(process.execPath, [stubPath], {
  env: { ...process.env, API_STUB_PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitForStub() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* todavía no levantó */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('el stub no levantó');
}

try {
  await waitForStub();

  // --- Árbol ---
  const tree = await (await fetch(`${BASE}/v1/categories`)).json();
  check('árbol: devuelve rubros con children', Array.isArray(tree.data) && tree.data.length >= 2);
  check(
    'árbol: climatizacion tiene el subrubro compresores-e2e',
    tree.data.find((r) => r.slug === 'climatizacion')?.children?.[0]?.slug === 'compresores-e2e',
  );

  // --- Detalle ---
  const sub = await (await fetch(`${BASE}/v1/categories/compresores-e2e`)).json();
  check('detalle: subrubro trae parent no-null', sub.parent?.slug === 'climatizacion');
  const rubro = await (await fetch(`${BASE}/v1/categories/climatizacion`)).json();
  check('detalle: rubro raíz trae parent null', rubro.parent === null);
  const missing = await fetch(`${BASE}/v1/categories/no-existe`);
  check('detalle: slug inexistente → 404', missing.status === 404);

  // --- Listado y agregación ---
  const subList = await (await fetch(`${BASE}/v1/categories/compresores-e2e/products`)).json();
  check('listado: total = 25 en el subrubro', subList.pagination.total === 25);
  check('listado: limit por defecto = 20', subList.data.length === 20);

  const rubroList = await (await fetch(`${BASE}/v1/categories/climatizacion/products`)).json();
  check(
    'agregación: un RUBRO agrega los productos de sus subrubros (D1)',
    rubroList.pagination.total === 25,
  );

  const page2 = await (
    await fetch(`${BASE}/v1/categories/compresores-e2e/products?limit=20&offset=20`)
  ).json();
  check('paginación: offset 20 devuelve los 5 restantes', page2.data.length === 5);
  check('paginación: total no cambia entre páginas', page2.pagination.total === 25);

  const vacia = await (await fetch(`${BASE}/v1/categories/vacia-e2e/products`)).json();
  check('categoría existente sin productos → 200 con data vacía', vacia.data.length === 0);

  const listMissing = await fetch(`${BASE}/v1/categories/no-existe/products`);
  check('listado de categoría inexistente → 404', listMissing.status === 404);

  for (const bad of ['limit=101', 'limit=0', 'offset=-1']) {
    const res = await fetch(`${BASE}/v1/categories/compresores-e2e/products?${bad}`);
    check(`validación: ${bad} → 422`, res.status === 422, `dio ${res.status}`);
  }

  // --- Ficha pública: sirve productos de AMBOS fixtures ---
  const pdp = await fetch(`${BASE}/v1/products/heladera-exhibidora`);
  check('ficha: producto del fixture PDP se sirve', pdp.status === 200);
  const pdpBrowse = await fetch(`${BASE}/v1/products/compresor-e2e-1`);
  check('ficha: producto del fixture de browse también se sirve', pdpBrowse.status === 200);

  // --- Reset por alcance: el punto crítico ---
  // Se muta el producto del que depende `pdp-invalidation.spec.ts` (US-003) y
  // se resetea SÓLO el catálogo: el precio del PDP NO debe volver solo, porque
  // si volviera, ese spec pasaría por el reset ajeno y no por su propia lógica.
  await fetch(`${BASE}/v1/admin/products/33333333-3333-4333-8333-333333333333`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ price_ars_cents: 999999 }),
  });
  await fetch(`${BASE}/__reset?scope=catalog`, { method: 'POST' });
  const afterCatalogReset = await (
    await fetch(`${BASE}/v1/products/ventilador-de-techo`)
  ).json();
  check(
    'reset scope=catalog NO toca el fixture de la PDP',
    afterCatalogReset.price_ars_cents === 999999,
    `precio quedó en ${afterCatalogReset.price_ars_cents}`,
  );

  await fetch(`${BASE}/__reset?scope=pdp`, { method: 'POST' });
  const afterPdpReset = await (await fetch(`${BASE}/v1/products/ventilador-de-techo`)).json();
  check(
    'reset scope=pdp restaura ventilador-de-techo a 1250000 (dependencia de US-003)',
    afterPdpReset.price_ars_cents === 1250000,
    `precio quedó en ${afterPdpReset.price_ars_cents}`,
  );

  await fetch(`${BASE}/v1/admin/products/33333333-3333-4333-8333-333333333333`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ price_ars_cents: 555555 }),
  });
  await fetch(`${BASE}/__reset`, { method: 'POST' });
  const afterFullReset = await (await fetch(`${BASE}/v1/products/ventilador-de-techo`)).json();
  check(
    'reset SIN scope sigue restaurando todo (compatibilidad con los specs de US-003)',
    afterFullReset.price_ars_cents === 1250000,
  );

  // --- Log de requests ---
  await fetch(`${BASE}/v1/categories/compresores-e2e/products?limit=20&offset=20`);
  const log = await (await fetch(`${BASE}/__requests`)).json();
  check(
    'log de requests: registra la query string',
    log.some((r) => r.url.includes('limit=20') && r.url.includes('offset=20')),
  );
} catch (error) {
  failures += 1;
  console.error(`  ✗ error inesperado: ${error.message}`);
} finally {
  child.kill();
}

console.log(failures === 0 ? '\n✓ api-stub self-test OK' : `\n✗ ${failures} chequeo(s) fallaron`);
process.exit(failures === 0 ? 0 : 1);
