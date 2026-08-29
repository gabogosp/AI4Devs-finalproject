import { expect, test } from '@playwright/test';

// Puerto por env como el resto de los specs: hardcodear 4010 rompe a quien
// corra con puertos propios para no chocar con otra sesión, y el síntoma
// (ECONNREFUSED) no se parece a su causa.
const STUB = `http://localhost:${process.env.API_STUB_PORT ?? 4010}`;

/**
 * US-014 T4.2 — recuperación de contraseña de punta a punta (AC-4/AC-7/AC-11).
 *
 * El token sale de una ruta de diagnóstico del stub, no de parsear un email ni
 * de adivinar: es lo que hace el journey determinista.
 */
test.describe('Journey de recuperación (T4.2)', () => {
  /**
   * **No se resetea el fixture.** Con `fullyParallel`, un `__reset?scope=auth`
   * acá le borra la sesión al spec de journey, que corre en otro worker: los
   * dos comparten el mismo alcance `auth`. En vez de serializar los archivos,
   * cada test que MUTA se crea su propia cuenta con un email único, así no hay
   * estado compartido que resetear.
   */
  const cuentaPropia = async (page: import('@playwright/test').Page) => {
    const email = `reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    await page.goto('/crear-cuenta');
    await page.getByLabel(/nombre/i).fill('Cliente Reset');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/contraseña/i).fill('Contrasena-Valida-1');
    await page.getByRole('button', { name: /crear cuenta/i }).click();
    await expect(page).toHaveURL(/\/mi-cuenta$/);
    await page.getByRole('button', { name: /cerrar sesión/i }).first().click();
    return email;
  };

  const pedirReset = async (page: import('@playwright/test').Page, email: string) => {
    await page.goto('/recuperar');
    await page.getByLabel(/email/i).fill(email);
    await Promise.all([
      page.waitForResponse('**/v1/auth/password-reset/request'),
      page.getByRole('button', { name: /enviar/i }).click(),
    ]);
    return (await page.getByRole('status').textContent()) ?? '';
  };

  test('AC-11: la confirmación es idéntica exista o no la cuenta', async ({ page }) => {
    const existe = await pedirReset(page, 'ana@example.com');
    const noExiste = await pedirReset(page, 'nadie@example.com');

    // Si difirieran en una coma, el formulario sería un verificador de emails
    // registrados.
    expect(existe).toBe(noExiste);
    expect(existe).toMatch(/si el email está registrado/i);
  });

  test('AC-4: con el token real se fija la contraseña y se puede ingresar', async ({
    page,
    request,
  }) => {
    const email = await cuentaPropia(page);
    await pedirReset(page, email);
    const { token } = await (
      await request.get(`${STUB}/__last-reset-token?email=${encodeURIComponent(email)}`)
    ).json();
    expect(token).toBeTruthy();

    await page.goto(`/recuperar/confirmar?token=${token}`);
    await page.getByLabel(/contraseña/i).fill('Contrasena-Nueva-9');
    await Promise.all([
      page.waitForResponse('**/v1/auth/password-reset/confirm'),
      page.getByRole('button', { name: /guardar/i }).click(),
    ]);
    await expect(page.getByRole('status')).toContainText(/ya podés ingresar/i);

    // La prueba de que la contraseña cambió de verdad: entrar con la nueva.
    await page.goto('/ingresar');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/contraseña/i).fill('Contrasena-Nueva-9');
    await page.getByRole('button', { name: /^ingresar$/i }).click();
    await expect(page).toHaveURL(/\/mi-cuenta$/);
  });

  test('el token desaparece de la URL al cargar la pantalla', async ({ page, request }) => {
    const email = await cuentaPropia(page);
    await pedirReset(page, email);
    const { token } = await (
      await request.get(`${STUB}/__last-reset-token?email=${encodeURIComponent(email)}`)
    ).json();

    await page.goto(`/recuperar/confirmar?token=${token}`);

    // Mientras viva en la barra viaja en el Referer y queda en el historial.
    await expect(page).toHaveURL(/\/recuperar\/confirmar$/);
    expect(page.url()).not.toContain(token);
  });

  test('AC-7: reusar el token da el mismo mensaje que uno vencido', async ({
    page,
    request,
  }) => {
    const email = await cuentaPropia(page);
    await pedirReset(page, email);
    const { token } = await (
      await request.get(`${STUB}/__last-reset-token?email=${encodeURIComponent(email)}`)
    ).json();

    const confirmarCon = async (t: string) => {
      await page.goto(`/recuperar/confirmar?token=${t}`);
      await page.getByLabel(/contraseña/i).fill('Contrasena-Nueva-9');
      await page.getByRole('button', { name: /guardar/i }).click();
      // Esperar el mensaje antes de leerlo: sin esto los dos textos salen
      // vacíos, la comparación de igualdad pasa —dos vacíos son iguales— y el
      // test quedaría verde sin haber probado nada.
      // Acotado a `main`: Next monta su route-announcer con role="alert".
      const alerta = page.locator('main').getByRole('alert');
      await alerta.waitFor();
      return (await alerta.textContent()) ?? '';
    };

    // Primer uso: consume el token.
    await page.goto(`/recuperar/confirmar?token=${token}`);
    await page.getByLabel(/contraseña/i).fill('Contrasena-Nueva-9');
    await page.getByRole('button', { name: /guardar/i }).click();
    await expect(page.getByRole('status')).toBeVisible();

    const reusado = await confirmarCon(token);
    const vencido = await confirmarCon('reset-token-vencido');

    expect(reusado).toBe(vencido);
    expect(reusado).toMatch(/no es válido o ya se usó/i);
  });

  test('la pantalla del token lleva noindex', async ({ page }) => {
    const res = await page.goto('/recuperar/confirmar?token=lo-que-sea');

    // El token viaja en la query: esta URL no puede terminar en un índice.
    const robotsHeader = res?.headers()['x-robots-tag'];
    const robotsMeta = await page
      .locator('meta[name="robots"]')
      .getAttribute('content')
      .catch(() => null);
    expect(`${robotsHeader ?? ''} ${robotsMeta ?? ''}`).toMatch(/noindex/i);
  });
});
