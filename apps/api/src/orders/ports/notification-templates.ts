import {
  OrderCancelledByOwnerPayload,
  OrderCancelledNoStockPayload,
  OrderConfirmedPayload,
  OrderReadyForPickupPayload,
  OwnerNewOrderPayload,
} from './notification.port';

/**
 * Plantillas de los emails del `NotificationPort` (US-011 T4.1; la 5ª,
 * `orderCancelledByOwner`, la agregó US-013 al ampliar el puerto durante el
 * rebase de este change — mismo patrón, sin AC propio de US-011) — texto +
 * HTML, sin librería de templating, mismo patrón que
 * `ResendPasswordResetMailer.cuerpoTexto`/`cuerpoHtml`.
 *
 * Todo campo string de origen externo (`buyerName`, `productName`) pasa por
 * `escapeHtml()` en la variante HTML — primer caso del repo donde un email
 * HTML interpola un string de origen externo (comprador / catálogo
 * importado). Ver `design.md` "Threat model". La variante texto NO necesita
 * escapado: no renderiza markup.
 */

const DIRECCION_LOCAL = 'Av. Córdoba y Av. Pueyrredón';

/** Escapa `& < > " '` — suficiente para interpolar texto dentro de HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatArs(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// orderConfirmed (AC-1)
// ---------------------------------------------------------------------------

export function orderConfirmedText(payload: OrderConfirmedPayload): string {
  const lineasItems = payload.items.map(
    (i) => `- ${i.productName} × ${i.quantity} — ${formatArs(i.unitPriceArsCents)}`,
  );
  return [
    `Hola ${payload.buyerName},`,
    '',
    '¡Listo! Tu compra está confirmada. Te enviamos el detalle por email.',
    '',
    `Orden #${payload.orderNumber}`,
    ...lineasItems,
    '',
    `Total: ${formatArs(payload.totalArsCents)}`,
    '',
    `Retirás en el local (${DIRECCION_LOCAL}). Te avisamos por email cuando esté lista.`,
  ].join('\n');
}

export function orderConfirmedHtml(payload: OrderConfirmedPayload): string {
  const filasItems = payload.items
    .map(
      (i) =>
        `<li>${escapeHtml(i.productName)} × ${i.quantity} — ${formatArs(i.unitPriceArsCents)}</li>`,
    )
    .join('\n');
  return [
    `<p>Hola ${escapeHtml(payload.buyerName)},</p>`,
    '<p>¡Listo! Tu compra está confirmada. Te enviamos el detalle por email.</p>',
    `<p><strong>Orden #${payload.orderNumber}</strong></p>`,
    `<ul>${filasItems}</ul>`,
    `<p>Total: <strong>${formatArs(payload.totalArsCents)}</strong></p>`,
    `<p>Retirás en el local (${DIRECCION_LOCAL}). Te avisamos por email cuando esté lista.</p>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// ownerNewOrder (AC-2)
// ---------------------------------------------------------------------------

export function ownerNewOrderText(payload: OwnerNewOrderPayload): string {
  return [
    'Nueva orden confirmada.',
    '',
    `Orden #${payload.orderNumber}`,
    `Total: ${formatArs(payload.totalArsCents)}`,
  ].join('\n');
}

export function ownerNewOrderHtml(payload: OwnerNewOrderPayload): string {
  return [
    '<p>Nueva orden confirmada.</p>',
    `<p><strong>Orden #${payload.orderNumber}</strong></p>`,
    `<p>Total: <strong>${formatArs(payload.totalArsCents)}</strong></p>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// orderReadyForPickup (AC-3)
// ---------------------------------------------------------------------------

export function orderReadyForPickupText(payload: OrderReadyForPickupPayload): string {
  return [
    `Hola ${payload.buyerName},`,
    '',
    'Tu pedido está listo para retirar en el local (Córdoba y Pueyrredón).',
    '',
    `Orden #${payload.orderNumber}`,
    '',
    'Llevá tu DNI o el N° de orden.',
  ].join('\n');
}

export function orderReadyForPickupHtml(payload: OrderReadyForPickupPayload): string {
  return [
    `<p>Hola ${escapeHtml(payload.buyerName)},</p>`,
    '<p>Tu pedido está listo para retirar en el local (Córdoba y Pueyrredón).</p>',
    `<p><strong>Orden #${payload.orderNumber}</strong></p>`,
    '<p>Llevá tu DNI o el N° de orden.</p>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// orderCancelledNoStock (completitud del puerto — OQ-1, sin AC propio)
// ---------------------------------------------------------------------------

export function orderCancelledNoStockText(payload: OrderCancelledNoStockPayload): string {
  return [
    `Hola ${payload.buyerName},`,
    '',
    `Tu orden #${payload.orderNumber} se canceló porque no había stock suficiente para completarla.`,
    '',
    'Si ya pagaste, te reintegramos el importe: no tenés que hacer nada más.',
    '',
    'Disculpá las molestias — escribinos por WhatsApp si tenés cualquier duda.',
  ].join('\n');
}

export function orderCancelledNoStockHtml(payload: OrderCancelledNoStockPayload): string {
  return [
    `<p>Hola ${escapeHtml(payload.buyerName)},</p>`,
    `<p>Tu orden #${payload.orderNumber} se canceló porque no había stock suficiente para completarla.</p>`,
    '<p>Si ya pagaste, te reintegramos el importe: no tenés que hacer nada más.</p>',
    '<p>Disculpá las molestias — escribinos por WhatsApp si tenés cualquier duda.</p>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// orderCancelledByOwner (US-013 AC-4 — completitud del puerto, sin AC propio
// de US-011; el método lo agregó US-013 al ampliar `NotificationPort` mientras
// esta US estaba en curso — mismo criterio que `orderCancelledNoStock`: dejarlo
// mudo reabriría el problema que el puerto fue diseñado para evitar)
// ---------------------------------------------------------------------------

export function orderCancelledByOwnerText(payload: OrderCancelledByOwnerPayload): string {
  return [
    `Hola ${payload.buyerName},`,
    '',
    `Tu orden #${payload.orderNumber} fue cancelada.`,
    '',
    'Si ya pagaste, te reintegramos el importe: no tenés que hacer nada más.',
    '',
    'Si tenés dudas, escribinos por WhatsApp.',
  ].join('\n');
}

export function orderCancelledByOwnerHtml(payload: OrderCancelledByOwnerPayload): string {
  return [
    `<p>Hola ${escapeHtml(payload.buyerName)},</p>`,
    `<p>Tu orden #${payload.orderNumber} fue cancelada.</p>`,
    '<p>Si ya pagaste, te reintegramos el importe: no tenés que hacer nada más.</p>',
    '<p>Si tenés dudas, escribinos por WhatsApp.</p>',
  ].join('\n');
}
