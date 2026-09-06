import { createHmac } from 'node:crypto';
import { parseSignatureHeader, verifyWebhookSignature } from './webhook-signature';

const SECRET = 'SECRETO-DE-TEST-NO-REAL';

function firmar(dataId: string, requestId: string, ts: string, secret = SECRET): string {
  const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return createHmac('sha256', secret).update(manifiesto).digest('hex');
}

describe('parseSignatureHeader', () => {
  it('parsea ts=...,v1=... en cualquier orden', () => {
    expect(parseSignatureHeader('ts=1700000000,v1=abc123')).toEqual({
      ts: '1700000000',
      v1: 'abc123',
    });
    expect(parseSignatureHeader('v1=abc123,ts=1700000000')).toEqual({
      ts: '1700000000',
      v1: 'abc123',
    });
  });

  it('tolera espacios alrededor de la coma', () => {
    expect(parseSignatureHeader('ts=1700000000, v1=abc123')).toEqual({
      ts: '1700000000',
      v1: 'abc123',
    });
  });

  it('header malformado (falta v1) devuelve null sin lanzar', () => {
    expect(parseSignatureHeader('ts=1700000000')).toBeNull();
  });

  it('header vacío o undefined devuelve null', () => {
    expect(parseSignatureHeader('')).toBeNull();
    expect(parseSignatureHeader(undefined)).toBeNull();
    expect(parseSignatureHeader(null)).toBeNull();
  });
});

describe('verifyWebhookSignature', () => {
  const dataId = '123456789';
  const requestId = 'req-1';
  const ts = '1700000000';
  const now = 1_700_000_000;

  it('firma válida dentro de la ventana → true', () => {
    const v1 = firmar(dataId, requestId, ts);

    expect(
      verifyWebhookSignature({ dataId, requestId, ts, v1, secret: SECRET, toleranceSec: 300, now }),
    ).toBe(true);
  });

  it('firma válida pero ts fuera de la ventana de tolerancia → false', () => {
    const v1 = firmar(dataId, requestId, ts);

    expect(
      verifyWebhookSignature({
        dataId,
        requestId,
        ts,
        v1,
        secret: SECRET,
        toleranceSec: 300,
        now: now + 301,
      }),
    ).toBe(false);
  });

  it('firma recalculada con secreto distinto → false', () => {
    const v1 = firmar(dataId, requestId, ts, 'OTRO-SECRETO');

    expect(
      verifyWebhookSignature({ dataId, requestId, ts, v1, secret: SECRET, toleranceSec: 300, now }),
    ).toBe(false);
  });

  it('un dataId o requestId distinto al firmado → false (no se puede reusar la firma para otro pago)', () => {
    const v1 = firmar(dataId, requestId, ts);

    expect(
      verifyWebhookSignature({
        dataId: 'otro-id',
        requestId,
        ts,
        v1,
        secret: SECRET,
        toleranceSec: 300,
        now,
      }),
    ).toBe(false);
  });

  it('ts no numérico → false sin lanzar', () => {
    expect(
      verifyWebhookSignature({
        dataId,
        requestId,
        ts: 'no-es-numero',
        v1: 'abc',
        secret: SECRET,
        toleranceSec: 300,
        now,
      }),
    ).toBe(false);
  });

  it('v1 de otro largo → false (el chequeo de largo evita el timingSafeEqual con buffers dispares)', () => {
    expect(
      verifyWebhookSignature({
        dataId,
        requestId,
        ts,
        v1: 'corto',
        secret: SECRET,
        toleranceSec: 300,
        now,
      }),
    ).toBe(false);
  });
});
