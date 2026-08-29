import { expect, test } from '@playwright/test';
import {
  login,
  logout,
  me,
  nuevaCuenta,
  PASSWORD_VALIDA,
  refresh,
  type Sesion,
} from '../support/customer-auth';

/**
 * TC-140/141/142 — el recorrido de cuenta contra la **API real** (US-014).
 *
 * Lo que esta capa agrega sobre la suite dev-owned: el frontend ya prueba esto contra
 * `api-stub.mjs`, donde bcrypt es una comparación de strings y la sesión vive en un
 * `Map`. Acá corre contra el backend real, con hash real y almacén de refresh en
 * Postgres, así que un desacuerdo entre el doble y la implementación aparece.
 *
 * Cada escenario siembra **su** cuenta: el lockout persiste en la base y una cuenta
 * compartida haría que el orden de ejecución cambie el resultado.
 */
test.describe('Cuenta del cliente contra la API real', () => {
  test('TC-140: el registro deja la sesión iniciada, sin verificación (AC-1)', async () => {
    const sesion: Sesion = await nuevaCuenta();

    // Sin ningún paso intermedio: la cuenta queda usable en el acto.
    expect(await me(sesion.ctx)).toBe(200);

    await sesion.ctx.dispose();
  });

  test('TC-140b: la contraseña no vuelve en la respuesta del registro (AC-8)', async () => {
    const sesion = await nuevaCuenta();
    const res = await sesion.ctx.get('/v1/auth/me');
    const cuerpo = await res.text();

    // Ni en claro ni hasheada: el hash en una respuesta es información que el cliente
    // no necesita y que un atacante sí puede usar offline.
    expect(cuerpo).not.toContain(PASSWORD_VALIDA);
    expect(cuerpo).not.toMatch(/\$2[aby]\$/);

    await sesion.ctx.dispose();
  });

  test('TC-141: login en un contexto nuevo y la sesión sobrevive (AC-2)', async () => {
    const { cuenta, ctx } = await nuevaCuenta();
    await ctx.dispose();

    // Contexto nuevo = el cliente que vuelve otro día.
    const { ctx: vuelta, status } = await login(cuenta);
    expect(status).toBe(200);
    expect(await me(vuelta)).toBe(200);

    // Y sigue válida en una segunda llamada: si la sesión viviera sólo en la respuesta
    // del login, esto lo caza.
    expect(await me(vuelta)).toBe(200);

    await vuelta.dispose();
  });

  test('TC-142: el logout invalida de verdad, también el refresh (AC-3)', async () => {
    const { ctx } = await nuevaCuenta();
    expect(await me(ctx)).toBe(200);

    expect(await logout(ctx)).toBe(204);

    // La sesión ya no sirve...
    expect(await me(ctx)).toBe(401);
    // ...y tampoco el refresh que tenía: sin este assert, «invalida» quedaría afirmado
    // sobre el access token y el refresh seguiría abriendo la puerta.
    expect(await refresh(ctx)).not.toBe(200);

    await ctx.dispose();
  });

  test('TC-142b: la contraseña incorrecta no abre sesión (AC-2 negativo)', async () => {
    const { cuenta, ctx } = await nuevaCuenta();
    await ctx.dispose();

    const { ctx: fallido, status } = await login(cuenta, 'Otra-Contrasena-9');
    expect(status).toBe(401);
    expect(await me(fallido)).toBe(401);

    await fallido.dispose();
  });
});
