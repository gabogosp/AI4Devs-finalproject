import { expect, test } from '@playwright/test';
import {
  datosDeCuenta,
  login,
  me,
  nuevaCuenta,
  nuevoContexto,
  pedirReset,
  refresh,
} from '../support/customer-auth';

/**
 * TC-144 / TC-147 / TC-148 — las propiedades de seguridad de US-014.
 *
 * No son features y **no se ven en la UI**: se verifican sobre status, cuerpo, headers,
 * cookies y —para AC-8— el stdout del proceso de la API. Un escenario que las mirara
 * por el DOM afirmaría algo más débil que el criterio.
 *
 * Corren contra la API **real**: con bcrypt real, que es justo lo que introduce la
 * diferencia de tiempo que TC-144 acota, y contra el almacén de refresh en Postgres,
 * que es lo único que puede probar la rotación de ADR-0011.
 */
test.describe('Propiedades de seguridad de la cuenta', () => {
  test('TC-144: login, registro y reset no distinguen si el email existe (AC-5, AC-6, AC-11)', async () => {
    const { cuenta, ctx } = await nuevaCuenta();
    await ctx.dispose();
    const inexistente = datosDeCuenta('-fantasma');
    const anon = await nuevoContexto();

    // --- Login: cuenta real con contraseña mala vs cuenta que no existe ---
    const t0 = Date.now();
    const conCuenta = await anon.post('/v1/auth/login', {
      data: { email: cuenta.email, password: 'Mala-Contrasena-9' },
    });
    const msConCuenta = Date.now() - t0;
    const cuerpoConCuenta = await conCuenta.text();

    const t1 = Date.now();
    const sinCuenta = await anon.post('/v1/auth/login', {
      data: { email: inexistente.email, password: 'Mala-Contrasena-9' },
    });
    const msSinCuenta = Date.now() - t1;

    expect(sinCuenta.status()).toBe(conCuenta.status());
    expect(await sinCuenta.text()).toBe(cuerpoConCuenta);

    // Banda AMPLIA a propósito (OQ-QA-3): un umbral fino sería flaky. Lo que se busca
    // es el caso que importa — que el email inexistente saltee bcrypt por completo y
    // responda un orden de magnitud más rápido, lo que vuelve la superficie un oráculo
    // cronometrable aunque el mensaje sea idéntico.
    expect(msSinCuenta * 10).toBeGreaterThan(msConCuenta);

    // --- Registro: email ya tomado (AC-6) ---
    const repetido = await anon.post('/v1/auth/register', {
      data: { email: cuenta.email, name: 'Otro', password: 'Contrasena-Valida-1' },
    });
    const cuerpoRepetido = await repetido.text();
    // No confirma la existencia: ni el type ni el detail nombran el email.
    expect(cuerpoRepetido).not.toContain(cuenta.email);

    // --- Reset: existente vs inexistente (AC-11) ---
    const resetReal = await pedirReset(anon, cuenta.email);
    const resetFantasma = await pedirReset(anon, inexistente.email);
    expect(resetFantasma.status).toBe(resetReal.status);

    await anon.dispose();
  });

  test('TC-147: la contraseña no sale por respuesta ni por log (AC-8)', async () => {
    // Contraseña canario irrepetible: si apareciera por cualquier canal, la búsqueda
    // no puede dar un falso negativo.
    const canario = `Canario-${Date.now()}-Zx9`;
    const datos = datosDeCuenta('-canario');
    const anon = await nuevoContexto();

    const registro = await anon.post('/v1/auth/register', {
      data: { email: datos.email, name: datos.nombre, password: canario },
    });
    expect([200, 201]).toContain(registro.status());
    const cuerpoRegistro = await registro.text();

    const acceso = await anon.post('/v1/auth/login', {
      data: { email: datos.email, password: canario },
    });
    const cuerpoLogin = await acceso.text();

    // Ni en claro ni el hash: un hash en la respuesta es material para atacar offline.
    for (const cuerpo of [cuerpoRegistro, cuerpoLogin]) {
      expect(cuerpo).not.toContain(canario);
      expect(cuerpo).not.toMatch(/\$2[aby]\$/);
    }

    // Y el log del proceso: un log con la credencial es el modo de fallo real y es
    // invisible desde el cliente.
    const { readFileSync } = await import('node:fs');
    const log = readFileSync(process.env.QA_API_LOG ?? '/tmp/api.log', 'utf8');
    expect(log).not.toContain(canario);

    await anon.dispose();
  });

  test('TC-148: cookies con sus flags y refresh de un solo uso (AC-9, ADR-0011)', async () => {
    const { ctx } = await nuevaCuenta();

    const cookies = (await ctx.storageState()).cookies;
    const acceso = cookies.find((c) => c.name === 'dsm_access');
    const csrf = cookies.find((c) => c.name === 'dsm_csrf');

    expect(acceso, 'la cookie de sesión tiene que existir').toBeDefined();
    // El token de sesión no es alcanzable por JS; el de CSRF sí, porque el
    // double-submit lo necesita del lado del cliente.
    expect(acceso!.httpOnly).toBe(true);
    expect(csrf!.httpOnly).toBe(false);
    expect(acceso!.sameSite).not.toBe('None');

    // Rotación: el primer refresh funciona...
    expect(await refresh(ctx)).toBe(200);
    expect(await me(ctx)).toBe(200);

    await ctx.dispose();
  });

  test('TC-148b: reusar un refresh ya rotado revoca la familia (ADR-0011)', async () => {
    const { cuenta, ctx } = await nuevaCuenta();
    await ctx.dispose();

    // Se conserva el estado con el refresh ORIGINAL antes de rotarlo.
    const { ctx: sesion } = await login(cuenta);
    const estadoViejo = await sesion.storageState();

    expect(await refresh(sesion)).toBe(200);

    // Un contexto con el refresh VIEJO: es el escenario de robo de token.
    const { request } = await import('@playwright/test');
    const ladron = await request.newContext({
      baseURL: process.env.QA_API_BASE_URL ?? 'http://localhost:3009',
      storageState: estadoViejo,
      extraHTTPHeaders: {
        origin: process.env.QA_WEB_BASE_URL ?? 'http://localhost:3220',
        'x-forwarded-for': '10.99.99.99',
      },
    });

    // El token rotado ya no sirve. Sin este assert, «rotado» quedaría afirmado y no
    // probado: un refresh que siguiera valiendo para siempre pasaría el test anterior.
    expect(await refresh(ladron)).not.toBe(200);

    await ladron.dispose();
    await sesion.dispose();
  });
});
