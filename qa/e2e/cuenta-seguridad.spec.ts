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
 * `/v1/auth/login` acepta **10 intentos / 15 min por IP** — el valor de PRODUCCIÓN
 * (`customer-auth.controller.ts`, `@Throttle({ auth: { limit: 10, ttl: 900_000 } })`).
 * No es una elección de la suite: esa ruta tiene su propio presupuesto por `@Throttle`
 * en el handler, que ignora `AUTH_RATE_LIMIT_MAX` por completo (§7.3 — son presupuestos
 * de producción a propósito, uno por ruta según cuán cara/abusable es). No hace falta un
 * proceso de API aparte para TC-146: la suite entera YA corre contra ese límite real.
 */
const LOGIN_INTENTOS_PERMITIDOS = 10;

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

  test('TC-146: el límite de intentos de login rechaza con 429 y Retry-After (AC-10)', async () => {
    const { cuenta } = await nuevaCuenta('-limite');
    // UN SOLO contexto: la IP simulada queda fija en sus headers, así que los
    // `LOGIN_INTENTOS_PERMITIDOS + 1` intentos caen en el mismo cubo de rate-limit.
    const atacante = await nuevoContexto();

    for (let i = 0; i < LOGIN_INTENTOS_PERMITIDOS; i++) {
      const intento = await atacante.post('/v1/auth/login', {
        data: { email: cuenta.email, password: 'Password-Incorrecta-9' },
      });
      // Ninguno de los intentos dentro del presupuesto es 429 todavía — si lo fuera,
      // el límite real sería más bajo que el documentado y el test estaría mal armado.
      expect(intento.status(), `intento ${i + 1} no debería estar limitado todavía`).toBe(401);
    }

    const bloqueado = await atacante.post('/v1/auth/login', {
      data: { email: cuenta.email, password: 'Password-Incorrecta-9' },
    });
    expect(bloqueado.status()).toBe(429);
    // La respuesta indica cuánto esperar: sin este header el cliente no sabe si
    // reintentar en un segundo o en una hora.
    expect(bloqueado.headers()['retry-after']).toBeDefined();

    await atacante.dispose();
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
