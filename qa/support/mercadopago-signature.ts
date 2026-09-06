import { createHmac } from 'node:crypto';

/**
 * T0.1 (`qa-plan.md` §9, `design.md` §D-QA4) — réplica **pura** del algoritmo
 * de `apps/api/src/payments/mercadopago/webhook-signature.ts`, sin importar
 * código de `apps/api/` (el harness de QA no depende del árbol de fuente del
 * backend — si algún día el algoritmo cambia sin que este archivo se
 * actualice, SC-010-N1 lo detecta rojo, que es la garantía que se busca).
 *
 * Formato real de MercadoPago: header `x-signature: ts=<epoch>,v1=<hmac-hex>`
 * — el HMAC-SHA256 se calcula sobre el manifiesto
 * `id:{dataId};request-id:{requestId};ts:{ts};`.
 */

export interface SignatureHeaders extends Record<string, string> {
  'x-signature': string;
  'x-request-id': string;
}

function manifiesto(dataId: string, requestId: string, ts: string): string {
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

function firmar(secret: string, dataId: string, requestId: string, ts: string): string {
  return createHmac('sha256', secret).update(manifiesto(dataId, requestId, ts)).digest('hex');
}

/** Headers con una firma VÁLIDA (formato correcto + secreto correcto). */
export function firmaValida(
  secret: string,
  dataId: string,
  requestId: string,
  ts: string,
): SignatureHeaders {
  const v1 = firmar(secret, dataId, requestId, ts);
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}

/**
 * Formato correcto, pero el HMAC se calculó con un secreto DISTINTO al real
 * — exactamente el caso que `SC-010-N1` ("con formato correcto pero secreto
 * equivocado") necesita distinguir de un header ausente o malformado.
 */
export function firmaConSecretoEquivocado(
  secretReal: string,
  dataId: string,
  requestId: string,
  ts: string,
): SignatureHeaders {
  const secretEquivocado = `${secretReal}-no-es-este`;
  const v1 = firmar(secretEquivocado, dataId, requestId, ts);
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}

/**
 * Header que NO matchea `ts=...,v1=...` en absoluto (sin `ts=`/`v1=`) — el
 * caso "header de firma ausente" se resuelve directamente no enviando el
 * header (el step lo omite), este helper cubre la variante "presente pero
 * malformado" si hiciera falta en el futuro.
 */
export function headerMalformado(): string {
  return 'esto-no-tiene-el-formato-esperado';
}

/**
 * Firma por lo demás VÁLIDA para un `ts` que ya cayó fuera de la ventana de
 * tolerancia (300s por default, `MP_WEBHOOK_TOLERANCE_SEC`) — el HMAC en sí
 * es correcto, lo que falla es la ventana temporal.
 */
export function firmaFueraDeVentana(
  secret: string,
  dataId: string,
  requestId: string,
  toleranceSec: number,
): SignatureHeaders {
  const tsViejo = String(Math.floor(Date.now() / 1000) - toleranceSec - 60);
  return firmaValida(secret, dataId, requestId, tsViejo);
}
