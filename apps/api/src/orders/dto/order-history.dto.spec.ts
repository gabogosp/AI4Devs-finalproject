import 'reflect-metadata';
import { Order, OrderItem } from '@dsm/db';
import { OrderWithItems } from '../../checkout/orders.repository';
import { OrderHistoryDetailDto, OrderHistorySummaryDto } from './order-history.dto';

function ordenBase(): Order {
  return {
    id: 'uuid-interno-no-debe-salir',
    order_number: 1042,
    access_token_hash: 'hash',
    customer_id: 'cust-1',
    buyer_name: 'Comprador de Prueba',
    buyer_email: 'comprador@test.local',
    buyer_phone: '+54 351 555 0000',
    fulfillment: 'pickup',
    status: 'new',
    total_ars_cents: 850_000,
    consent_accepted: true,
    consent_accepted_at: new Date('2026-08-01'),
    consent_terms_version: '2026-06-15',
    created_at: new Date('2026-08-01T12:00:00.000Z'),
    updated_at: new Date('2026-08-01T12:00:00.000Z'),
    delivered_at: null,
    confirmed_at: null,
    cancelled_at: null,
    anonymized_at: null,
    anonymization_reason: null,
  } as Order;
}

function itemBase(): OrderItem {
  return {
    id: 'item-1',
    order_id: 'uuid-interno-no-debe-salir',
    product_id: 'prod-1',
    product_name: 'Gas R134a',
    product_sku: 'ORD-REPO-B',
    quantity: 2,
    unit_price_ars_cents: 850_000,
  } as OrderItem;
}

describe('OrderHistorySummaryDto (US-015 T3.2, AC-1)', () => {
  it('nunca incluye id (UUID) ni buyer_* en las claves del objeto devuelto', () => {
    const dto = OrderHistorySummaryDto.from(ordenBase());
    const claves = Object.keys(dto);

    expect(claves).not.toContain('id');
    expect(claves).not.toContain('buyer_name');
    expect(claves).not.toContain('buyer_email');
    expect(claves).not.toContain('buyer_phone');
    expect(claves.sort()).toEqual(
      ['created_at', 'order_number', 'status', 'total_ars_cents'].sort(),
    );
  });

  it('proyecta order_number, status, total_ars_cents, created_at (AC-1)', () => {
    const dto = OrderHistorySummaryDto.from(ordenBase());

    expect(dto.order_number).toBe(1042);
    expect(dto.status).toBe('new');
    expect(dto.total_ars_cents).toBe(850_000);
    expect(dto.created_at).toBe('2026-08-01T12:00:00.000Z');
  });
});

describe('OrderHistoryDetailDto (US-015 T3.2, AC-2)', () => {
  it('suma fulfillment + items, reusando AdminOrderItemDto.from(), sin id ni buyer_*', () => {
    const orden: OrderWithItems = { ...ordenBase(), items: [itemBase()] };
    const dto = OrderHistoryDetailDto.fromDetail(orden);
    const claves = Object.keys(dto);

    expect(claves).not.toContain('id');
    expect(claves).not.toContain('buyer_name');
    expect(claves).not.toContain('buyer_email');
    expect(claves).not.toContain('buyer_phone');
    expect(dto.fulfillment).toBe('pickup');
    expect(dto.items).toEqual([
      {
        product_name: 'Gas R134a',
        product_sku: 'ORD-REPO-B',
        quantity: 2,
        unit_price_ars_cents: 850_000,
        subtotal_ars_cents: 1_700_000,
      },
    ]);
  });
});
