import {
  firmaConSecretoEquivocado,
  firmaFueraDeVentana,
  firmaValida,
  headerMalformado,
} from './mercadopago-signature';

/**
 * Smoke sin red (T0.1): se auto-verifica sin necesitar la API arriba, mismo
 * estilo que `admin-auth.smoke.ts`/`cart-client.smoke.ts`.
 */
async function main(): Promise<void> {
  const secret = 'qa-test-secret';
  const dataId = '1234567890';
  const requestId = 'req-abc';
  const ts = String(Math.floor(Date.now() / 1000));

  const valida = firmaValida(secret, dataId, requestId, ts);
  const equivocada = firmaConSecretoEquivocado(secret, dataId, requestId, ts);

  if (valida['x-signature'] === equivocada['x-signature']) {
    console.error('FAIL: firmaValida y firmaConSecretoEquivocado produjeron el mismo v1');
    process.exit(1);
  }
  if (!/^ts=\d+,v1=[0-9a-f]{64}$/.test(valida['x-signature'])) {
    console.error(`FAIL: firmaValida no matchea el formato esperado: ${valida['x-signature']}`);
    process.exit(1);
  }

  const malformado = headerMalformado();
  if (/^ts=\d+,v1=[0-9a-f]{64}$/.test(malformado)) {
    console.error('FAIL: headerMalformado() matcheó accidentalmente el formato válido');
    process.exit(1);
  }

  const fueraDeVentana = firmaFueraDeVentana(secret, dataId, requestId, 300);
  const tsFuera = Number(fueraDeVentana['x-signature'].match(/ts=(\d+)/)?.[1]);
  const ahora = Math.floor(Date.now() / 1000);
  if (Math.abs(ahora - tsFuera) <= 300) {
    console.error('FAIL: firmaFueraDeVentana produjo un ts dentro de la ventana de 300s');
    process.exit(1);
  }

  console.log('OK: mercadopago-signature — firmaValida/firmaConSecretoEquivocado/headerMalformado/firmaFueraDeVentana');
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
