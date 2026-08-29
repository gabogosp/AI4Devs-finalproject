import { expect, test } from '@playwright/test';

// Sin uso desde que los specs dejaron de resetear el fixture compartido.

/**
 * US-014 T4.1 — journey completo contra la app CONSTRUIDA.
 *
 * Los estados se afirman sobre `response.status()` y `context.cookies()`, no
 * sobre el DOM: un assert de DOM no distingue una sesión real de una pantalla
 * que dice "hola" (misma familia que el soft-200 de F59).
 */
test.describe('Journey de cuenta (T4.1)', () => {
  /**
   * **Sin reset del fixture**: el alcance `auth` lo comparten los dos specs de
   * auth, que con `fullyParallel` corren en workers distintos — resetear acá le
   * borraría la sesión al otro a mitad de corrida. Ninguno de estos tests muta
   * la cuenta sembrada: los que crean datos usan un email único.
   */

  test('registro deja sesión activa sin pasar por login (AC-1)', async ({
    page,
    context,
  }) => {
    await page.goto('/crear-cuenta');

    const email = `nueva-${Date.now()}@example.com`;
    await page.getByLabel(/nombre/i).fill('Cliente Nuevo');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/contraseña/i).fill('Contrasena-Valida-1');

    const [res] = await Promise.all([
      page.waitForResponse('**/v1/auth/register'),
      page.getByRole('button', { name: /crear cuenta/i }).click(),
    ]);
    expect(res.status()).toBe(201);

    // AC-1: queda con sesión, sin haber pasado por /ingresar.
    await expect(page).toHaveURL(/\/mi-cuenta$/);
    await expect(page.getByText(email)).toBeVisible();

    // AC-9 desde el navegador real.
    const cookies = await context.cookies();
    const access = cookies.find((c) => c.name === 'dsm_access');
    const refresh = cookies.find((c) => c.name === 'dsm_refresh');
    expect(access?.httpOnly).toBe(true);
    expect(refresh?.httpOnly).toBe(true);

    const visibles = await page.evaluate(() => document.cookie);
    expect(visibles).not.toContain('dsm_access');
    expect(visibles).not.toContain('dsm_refresh');
  });

  test('logout invalida la sesión y mi-cuenta redirige (AC-3)', async ({ page }) => {
    await page.goto('/ingresar');
    await page.getByLabel(/email/i).fill('ana@example.com');
    await page.getByLabel(/contraseña/i).fill('Contrasena-Valida-1');
    await page.getByRole('button', { name: /^ingresar$/i }).click();
    await expect(page).toHaveURL(/\/mi-cuenta$/);

    const [res] = await Promise.all([
      page.waitForResponse('**/v1/auth/logout'),
      page.getByRole('button', { name: /cerrar sesión/i }).first().click(),
    ]);
    expect(res.status()).toBe(204);

    // El destino protegido ya no es alcanzable.
    await page.goto('/mi-cuenta');
    await expect(page).toHaveURL(/\/ingresar/);
  });

  test('volver a entrar con las mismas credenciales funciona (AC-2)', async ({
    page,
  }) => {
    for (const vuelta of [1, 2]) {
      await page.goto('/ingresar');
      await page.getByLabel(/email/i).fill('ana@example.com');
      await page.getByLabel(/contraseña/i).fill('Contrasena-Valida-1');
      await page.getByRole('button', { name: /^ingresar$/i }).click();
      await expect(page, `vuelta ${vuelta}`).toHaveURL(/\/mi-cuenta$/);

      await page.getByRole('button', { name: /cerrar sesión/i }).first().click();
      await expect(page.getByRole('link', { name: /ingresar/i }).first()).toBeVisible();
    }
  });

  test('el 401 no distingue entre cuenta inexistente y contraseña incorrecta (AC-5)', async ({
    page,
  }) => {
    const textos: string[] = [];
    for (const cred of [
      { email: 'ana@example.com', password: 'incorrecta' },
      { email: 'nadie@example.com', password: 'incorrecta' },
      { email: 'bloqueada@example.com', password: 'Contrasena-Valida-1' },
    ]) {
      await page.goto('/ingresar');
      await page.getByLabel(/email/i).fill(cred.email);
      await page.getByLabel(/contraseña/i).fill(cred.password);
      await page.getByRole('button', { name: /^ingresar$/i }).click();
      textos.push((await page.locator('main').getByRole('alert').textContent()) ?? '');
    }

    expect(new Set(textos).size).toBe(1);
  });
});
