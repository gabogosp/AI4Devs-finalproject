import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificación de firma del webhook de MercadoPago (US-010 T4.1,
 * `security-standards.md` §6) — funciones **puras**, sin llamada de red ni
 * cuenta real necesaria para probarlas.
 *
 * Formato real de MercadoPago: header `x-signature: ts=<epoch>,v1=<hmac-hex>`
 * — el HMAC-SHA256 se calcula sobre el manifiesto
 * `id:{dataId};request-id:{requestId};ts:{ts};` con `MP_WEBHOOK_SECRET`.
 */

export interface ParsedSignature {
  ts: string;
  v1: string;
}

/**
 * Parsea `ts=...,v1=...` (orden y espacios no importan; MP no los garantiza).
 * `null` si falta cualquiera de las dos claves — nunca lanza.
 */
export function parseSignatureHeader(raw: string | undefined | null): ParsedSignature | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  const partes = raw.split(',');
  let ts: string | undefined;
  let v1: string | undefined;
  for (const parte of partes) {
    const [clave, ...resto] = parte.split('=');
    const valor = resto.join('=').trim();
    if (clave.trim() === 'ts') ts = valor;
    if (clave.trim() === 'v1') v1 = valor;
  }
  if (!ts || !v1) return null;
  return { ts, v1 };
}

export interface VerifyWebhookSignatureInput {
  dataId: string;
  requestId: string;
  ts: string;
  v1: string;
  secret: string;
  /** Ventana de tolerancia sobre `ts`, en segundos. */
  toleranceSec: number;
  /** Epoch actual, en segundos — inyectable para tests deterministas. */
  now: number;
}

/**
 * Recalcula el HMAC-SHA256 sobre el manifiesto y compara en tiempo constante
 * (`timingSafeEqual` con chequeo de largo previo, calcado de
 * `cart/cart-csrf.guard.ts` — un `===` filtra por timing cuántos caracteres
 * coincidieron). `false` en cualquier caso de fallo — nunca lanza, para que
 * el controller siempre pueda responder 401 sin un try/catch adicional.
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  const tsNum = Number(input.ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(input.now - tsNum) > input.toleranceSec) return false;

  const manifiesto = `id:${input.dataId};request-id:${input.requestId};ts:${input.ts};`;
  const esperado = createHmac('sha256', input.secret).update(manifiesto).digest('hex');

  const a = Buffer.from(input.v1, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
