/**
 * Gate de despliegue: impide publicar con el número de WhatsApp de fábrica.
 *
 * Vive FUERA del build a propósito. Un guard dentro de `env.ts` mataría la suite
 * E2E, porque el `webServer` de Playwright corre un build de producción real sin
 * esa variable definida — y el riesgo que se quiere cubrir no es construir mal,
 * es *publicar* mal.
 *
 * Enganche al pipeline: `Deferred: US-019` (infra es dueña del job de deploy).
 */
const PLACEHOLDER = '5491100000000';
const phone = process.env.NEXT_PUBLIC_WHATSAPP_PHONE;

if (!phone || phone === PLACEHOLDER) {
  console.error(
    'NEXT_PUBLIC_WHATSAPP_PHONE ausente o con el placeholder de fábrica.\n' +
      'Publicar así ofrece un canal de contacto que no existe: el visitante\n' +
      'escribe y nadie contesta — peor que no ofrecerlo (OQ-FE-3, owner PO/cliente).',
  );
  process.exit(1);
}

console.log('OK — WhatsApp configurado.');
