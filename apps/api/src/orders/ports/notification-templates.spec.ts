import { readFileSync } from 'fs';
import { join } from 'path';
import {
  orderCancelledNoStockHtml,
  orderCancelledNoStockText,
  orderConfirmedHtml,
  orderConfirmedText,
  orderReadyForPickupHtml,
  orderReadyForPickupText,
  ownerNewOrderHtml,
  ownerNewOrderText,
} from './notification-templates';

const CONFIRMED_PAYLOAD = {
  orderId: 'order-1',
  orderNumber: 1001,
  buyerName: 'Ana Pérez',
  buyerEmail: 'ana@example.com',
  items: [{ productName: 'Tornillo 3mm', quantity: 2, unitPriceArsCents: 50_000 }],
  totalArsCents: 100_000,
};

const READY_PAYLOAD = {
  orderId: 'order-2',
  orderNumber: 1002,
  buyerName: 'Ana Pérez',
  buyerEmail: 'ana@example.com',
};

const OWNER_PAYLOAD = { orderId: 'order-1', orderNumber: 1001, totalArsCents: 100_000 };

const CANCELLED_PAYLOAD = {
  orderId: 'order-3',
  orderNumber: 1003,
  buyerName: 'Ana Pérez',
  buyerEmail: 'ana@example.com',
};

describe('notification-templates (US-011 T4.1)', () => {
  it('orderConfirmedText incluye la frase exacta de design-system §10.2', () => {
    expect(orderConfirmedText(CONFIRMED_PAYLOAD)).toContain(
      '¡Listo! Tu compra está confirmada. Te enviamos el detalle por email.',
    );
  });

  it('orderReadyForPickupText incluye la frase exacta de design-system §10.2', () => {
    expect(orderReadyForPickupText(READY_PAYLOAD)).toContain(
      'Tu pedido está listo para retirar en el local (Córdoba y Pueyrredón).',
    );
  });

  it('orderConfirmedHtml escapa un buyerName con markup — no debe contener <script> sin escapar', () => {
    const payload = { ...CONFIRMED_PAYLOAD, buyerName: '<script>x</script>' };
    const html = orderConfirmedHtml(payload);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('orderConfirmedHtml también escapa un productName con markup', () => {
    const payload = {
      ...CONFIRMED_PAYLOAD,
      items: [{ productName: '<img onerror=alert(1)>', quantity: 1, unitPriceArsCents: 1_000 }],
    };
    const html = orderConfirmedHtml(payload);
    expect(html).not.toContain('<img onerror=alert(1)>');
  });

  it('orderReadyForPickupHtml escapa buyerName', () => {
    const payload = { ...READY_PAYLOAD, buyerName: '<script>x</script>' };
    expect(orderReadyForPickupHtml(payload)).not.toContain('<script>x</script>');
  });

  it('orderCancelledNoStockHtml escapa buyerName', () => {
    const payload = { ...CANCELLED_PAYLOAD, buyerName: '<script>x</script>' };
    expect(orderCancelledNoStockHtml(payload)).not.toContain('<script>x</script>');
  });

  it('ownerNewOrderText/Html incluyen el total', () => {
    expect(ownerNewOrderText(OWNER_PAYLOAD)).toContain('1001');
    expect(ownerNewOrderHtml(OWNER_PAYLOAD)).toContain('1001');
  });

  it('orderCancelledNoStockText incluye el número de orden', () => {
    expect(orderCancelledNoStockText(CANCELLED_PAYLOAD)).toContain('1003');
  });

  it('AC-8 defensivo: el archivo completo no contiene subcadenas de datos de pago', () => {
    const contenido = readFileSync(join(__dirname, 'notification-templates.ts'), 'utf-8');
    for (const prohibida of ['payment', 'card', 'tarjeta', 'cvv', 'external_id']) {
      expect(contenido.toLowerCase()).not.toContain(prohibida);
    }
  });
});
