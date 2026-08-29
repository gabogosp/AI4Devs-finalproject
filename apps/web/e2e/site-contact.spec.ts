import { test, expect } from '@playwright/test';

/**
 * AC-1 y AC-3 sobre el HTML **servido**, no sobre el DOM hidratado: el enlace
 * tiene que estar en la respuesta inicial, igual que lo vería un crawler o un
 * visitante con JavaScript deshabilitado.
 *
 * No se navega a WhatsApp: es un servicio de terceros y el límite de este
 * sistema es emitir el `<a href>` correcto.
 */
// `climatizacion` es la categoría del fixture de browse del stub del contrato
// (`e2e/support/api-stub.mjs`). No se usa un slug de los datos reales de la
// API: este spec corre contra el stub, no contra la base sembrada.
for (const path of ['/', '/categorias/climatizacion']) {
  test(`${path} sirve el enlace de WhatsApp en header y footer (AC-1)`, async ({
    page,
  }) => {
    const res = await page.goto(path);
    expect(res!.status()).toBe(200);

    const html = await res!.text();

    // Forma canónica: `wa.me` + sólo dígitos. Es lo que hace funcionar el
    // desvío a la app móvil, a WhatsApp Web o a la de escritorio (AC-3), sin
    // ninguna detección de dispositivo de nuestro lado.
    expect(html).toMatch(/https:\/\/wa\.me\/\d{8,15}/);

    expect(html).toContain('Hablá con nosotros'); // footer
    expect(html).toContain('rel="noopener noreferrer"');
  });
}

test('el panel del dueño NO ofrece el canal de atención (ADR-0010)', async ({
  page,
}) => {
  // El canal es superficie pública. El panel es la superficie privada del
  // dueño: ofrecerle ahí un "hablá con nosotros" no tiene sentido y ensuciaría
  // la separación que fija ADR-0010.
  const res = await page.goto('/admin/acceso');

  expect(res!.status()).toBe(200);
  expect(await res!.text()).not.toContain('wa.me');
});
