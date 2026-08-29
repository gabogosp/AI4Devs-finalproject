import { expect, test } from '@playwright/test';
import {
  login,
  me,
  nuevaCuenta,
  nuevoContexto,
  pedirReset,
  marcaDeLog,
  tokenDeResetDesde,
} from '../support/customer-auth';

/**
 * TC-143 / TC-145 — recuperación de contraseña contra la API real (AC-4, AC-7).
 *
 * El token se lee del log del proceso de la API (el mailer de log lo escribe fuera de
 * producción): no hay endpoint que lo exponga, y está bien que no lo haya — viaja por
 * email. Verificar la bandeja real es del PO (OQ-QA-4).
 */
const NUEVA = 'Contrasena-Nueva-7';

async function confirmar(token: string, password: string): Promise<number> {
  const ctx = await nuevoContexto();
  const res = await ctx.post('/v1/auth/password-reset/confirm', {
    data: { token, password },
  });
  const status = res.status();
  await ctx.dispose();
  return status;
}

test.describe('Recuperación de contraseña contra la API real', () => {
  test('TC-143: se fija una contraseña nueva y la anterior deja de servir (AC-4)', async () => {
    const { cuenta, ctx } = await nuevaCuenta();
    await ctx.dispose();

    const marca = marcaDeLog();
    const anon = await nuevoContexto();
    const pedido = await pedirReset(anon, cuenta.email);
    await anon.dispose();
    expect(pedido.status).toBeLessThan(400);

    expect(await confirmar(await tokenDeResetDesde(marca), NUEVA)).toBeLessThan(400);

    // Entra con la nueva...
    const conNueva = await login(cuenta, NUEVA);
    expect(conNueva.status).toBe(200);
    expect(await me(conNueva.ctx)).toBe(200);
    await conNueva.ctx.dispose();

    // ...y NO con la anterior. Sin este assert, el escenario pasaría aunque la
    // contraseña no hubiera cambiado en absoluto.
    const conVieja = await login(cuenta, cuenta.password);
    expect(conVieja.status).toBe(401);
    await conVieja.ctx.dispose();
  });

  test('TC-145: el token ya usado no sirve de nuevo (AC-7)', async () => {
    const { cuenta, ctx } = await nuevaCuenta();
    await ctx.dispose();

    const marca = marcaDeLog();
    const anon = await nuevoContexto();
    await pedirReset(anon, cuenta.email);
    await anon.dispose();

    const token = await tokenDeResetDesde(marca);
    expect(await confirmar(token, NUEVA)).toBeLessThan(400);

    // Segundo uso del MISMO enlace: uso único (AC-7).
    expect(await confirmar(token, 'Otra-Mas-Todavia-3')).toBeGreaterThanOrEqual(400);

    // Y la contraseña quedó en la del primer uso, no en la del intento rechazado.
    const conNueva = await login(cuenta, NUEVA);
    expect(conNueva.status).toBe(200);
    await conNueva.ctx.dispose();
  });

  test('TC-145b: pedir reset de un email inexistente responde igual (AC-11)', async () => {
    const anon = await nuevoContexto();

    const existe = await nuevaCuenta('-real');
    await existe.ctx.dispose();
    const conCuenta = await pedirReset(anon, existe.cuenta.email);
    const sinCuenta = await pedirReset(anon, `no-existe-${Date.now()}@example.test`);
    await anon.dispose();

    // Mismo status: si difirieran, la superficie sería un oráculo de emails
    // registrados y AC-11 no se sostendría.
    expect(sinCuenta.status).toBe(conCuenta.status);
  });
});
