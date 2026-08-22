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

  // --- Superficie de auth de cliente (US-014 T0.2) ---
  await fetch(`${BASE}/__reset?scope=auth`, { method: 'POST' });

  const postAuth = (ruta, body, headers = {}) =>
    fetch(`${BASE}/v1/auth/${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    });

  const login = await postAuth('login', {
    email: 'ana@example.com',
    password: 'Contrasena-Valida-1',
  });
  const cookiesLogin = login.headers.getSetCookie();
  check('login válido → 200', login.status === 200, `status ${login.status}`);
  check(
    'login emite las tres cookies',
    ['dsm_access', 'dsm_refresh', 'dsm_csrf'].every((c) =>
      cookiesLogin.some((sc) => sc.startsWith(`${c}=`)),
    ),
    cookiesLogin.join(' | '),
  );
  check(
    'dsm_access es HttpOnly y dsm_csrf NO (double-submit)',
    cookiesLogin.some((c) => c.startsWith('dsm_access=') && c.includes('HttpOnly')) &&
      cookiesLogin.some((c) => c.startsWith('dsm_csrf=') && !c.includes('HttpOnly')),
  );
  check(
    'dsm_refresh se acota a /v1/auth (no viaja al catálogo)',
    cookiesLogin.some((c) => c.startsWith('dsm_refresh=') && c.includes('Path=/v1/auth')),
  );

  // AC-5: los tres 401 tienen que ser indistinguibles.
  const malPass = await postAuth('login', { email: 'ana@example.com', password: 'x' });
  const noExiste = await postAuth('login', { email: 'nadie@example.com', password: 'x' });
  const bloqueada = await postAuth('login', {
    email: 'bloqueada@example.com',
    password: 'Contrasena-Valida-1',
  });
  const cuerpos = await Promise.all([malPass.json(), noExiste.json(), bloqueada.json()]);
  check(
    'AC-5: contraseña mala, cuenta inexistente y cuenta bloqueada dan 401 idéntico',
    [malPass, noExiste, bloqueada].every((r) => r.status === 401) &&
      new Set(cuerpos.map((c) => JSON.stringify(c))).size === 1,
    JSON.stringify(cuerpos),
  );
  check(
    'ninguno de los tres 401 emite cookies',
    [malPass, noExiste, bloqueada].every((r) => r.headers.getSetCookie().length === 0),
  );

  const dup = await postAuth('register', {
    email: 'ana@example.com',
    password: 'Otra-Contrasena-1',
    name: 'Ana',
  });
  check('registro con email existente → 409 genérico', dup.status === 409);
  check(
    'el 409 no menciona el email (anti-enumeración)',
    !JSON.stringify(await dup.json()).includes('ana@example.com'),
  );

  const alta = await postAuth('register', {
    email: 'nueva@example.com',
    password: 'Contrasena-Valida-1',
    name: 'Nueva',
  });
  check('registro nuevo → 201 con sesión inmediata (AC-1)', alta.status === 201);
  check('el registro emite cookies', alta.headers.getSetCookie().length === 3);

  // CSRF: las escrituras autenticadas exigen header Y origin.
  const accessCookie = cookiesLogin
    .find((c) => c.startsWith('dsm_access='))
    .split(';')[0];
  const csrfValor = cookiesLogin
    .find((c) => c.startsWith('dsm_csrf='))
    .split(';')[0]
    .split('=')[1];

  const sinCsrf = await postAuth('logout', {}, { Cookie: accessCookie, Origin: BASE });
  check('logout sin X-CSRF-Token → 403', sinCsrf.status === 403);

  const sinOrigin = await postAuth('logout', {}, {
    Cookie: accessCookie,
    'X-CSRF-Token': csrfValor,
  });
  check('logout sin Origin → 403', sinOrigin.status === 403);

  const me = await fetch(`${BASE}/v1/auth/me`, { headers: { Cookie: accessCookie } });
  check('me con sesión → 200', me.status === 200);

  const logout = await postAuth('logout', {}, {
    Cookie: accessCookie,
    Origin: BASE,
    'X-CSRF-Token': csrfValor,
  });
  check('logout con CSRF y Origin → 204', logout.status === 204);
  check(
    'logout expira las cookies (Max-Age=0)',
    logout.headers.getSetCookie().every((c) => c.includes('Max-Age=0')),
  );

  const meDespues = await fetch(`${BASE}/v1/auth/me`, {
    headers: { Cookie: accessCookie },
  });
  check('tras logout la sesión no sirve → 401', meDespues.status === 401);

  // AC-11: 202 siempre, exista o no el email.
  const resetExiste = await postAuth('password-reset/request', { email: 'ana@example.com' });
  const resetNoExiste = await postAuth('password-reset/request', { email: 'nadie@example.com' });
  check(
    'AC-11: reset-request da 202 exista o no la cuenta',
    resetExiste.status === 202 && resetNoExiste.status === 202,
  );

  const confirmVencido = await postAuth('password-reset/confirm', {
    token: 'reset-token-vencido',
    password: 'Nueva-Contrasena-1',
  });
  const confirmUsado = await postAuth('password-reset/confirm', {
    token: 'reset-token-usado',
    password: 'Nueva-Contrasena-1',
  });
  const confirmInexistente = await postAuth('password-reset/confirm', {
    token: 'no-existe',
    password: 'Nueva-Contrasena-1',
  });
  const cuerposReset = await Promise.all([
    confirmVencido.json(),
    confirmUsado.json(),
    confirmInexistente.json(),
  ]);
  check(
    'AC-7: token vencido, usado e inexistente dan el MISMO 400',
    [confirmVencido, confirmUsado, confirmInexistente].every((r) => r.status === 400) &&
      new Set(cuerposReset.map((c) => JSON.stringify(c))).size === 1,
  );

  const confirmOk = await postAuth('password-reset/confirm', {
    token: 'reset-token-valido',
    password: 'Nueva-Contrasena-1',
  });
  check('reset con token válido → 200', confirmOk.status === 200);
  const reuso = await postAuth('password-reset/confirm', {
    token: 'reset-token-valido',
    password: 'Otra-Mas-1',
  });
  check('el token de reset es de un solo uso → 400 al reusarlo', reuso.status === 400);

  const forzado = await postAuth('login', {}, { 'X-Force-Rate-Limit': '1' });
  check('AC-10: 429 forzado trae Retry-After', forzado.status === 429 &&
    forzado.headers.get('retry-after') === '42');

  // Aislamiento: resetear auth NO puede tocar el catálogo ni la PDP.
  await fetch(`${BASE}/v1/admin/products/33333333-3333-4333-8333-333333333333`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ price_ars_cents: 888888 }),
  });
  await fetch(`${BASE}/__reset?scope=auth`, { method: 'POST' });
  const pdpTrasAuth = await (await fetch(`${BASE}/v1/products/ventilador-de-techo`)).json();
  check(
    'reset scope=auth NO restaura la PDP (aislamiento de fixtures)',
    pdpTrasAuth.price_ars_cents === 888888,
    `precio ${pdpTrasAuth.price_ars_cents}`,
  );

} catch (error) {
  failures += 1;
  console.error(`  ✗ error inesperado: ${error.message}`);
} finally {
  child.kill();
}

console.log(failures === 0 ? '\n✓ api-stub self-test OK' : `\n✗ ${failures} chequeo(s) fallaron`);
process.exit(failures === 0 ? 0 : 1);
