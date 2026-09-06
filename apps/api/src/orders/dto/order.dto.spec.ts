import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AdminOrderDetailDto,
  ListOrdersQueryDto,
  UpdateOrderStatusDto,
} from './order.dto';
import { OrderWithItems } from '../../checkout/orders.repository';

const ordenBase = (over: Partial<OrderWithItems> = {}): OrderWithItems =>
  ({
    id: 'a3f1e2b0-0000-4000-8000-000000000001',
    order_number: 1042,
    buyer_name: 'Juana Pérez',
    buyer_email: 'juana@example.com',
    buyer_phone: '+541122334455',
    status: 'new',
    fulfillment: 'pickup',
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    anonymized_at: null,
    anonymization_reason: null,
    items: [],
    ...over,
  }) as unknown as OrderWithItems;

/**
 * T7.1 — el contrato del borde, ejercido sin HTTP: `plainToInstance` +
 * `validate` es exactamente lo que hace el `ValidationPipe` global.
 */
const violacionesListado = async (payload: unknown) =>
  validate(plainToInstance(ListOrdersQueryDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const violacionesUpdate = async (payload: unknown) =>
  validate(plainToInstance(UpdateOrderStatusDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('ListOrdersQueryDto (T7.1, AC-1/AC-5)', () => {
  it('acepta el query vacío con defaults (limit=20, offset=0, sort=-created_at)', async () => {
    const dto = plainToInstance(ListOrdersQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(20);
    expect(dto.offset).toBe(0);
    expect(dto.sort).toBe('-created_at');
  });

  it('status fuera del enum de 4 activos → violación (pending_payment/cancelled no son valores válidos)', async () => {
    expect(await violacionesListado({ status: 'pending_payment' })).not.toHaveLength(0);
    expect(await violacionesListado({ status: 'cancelled' })).not.toHaveLength(0);
    expect(await violacionesListado({ status: 'new' })).toHaveLength(0);
  });

  it('sort fuera de los 6 valores del enum cerrado → violación', async () => {
    expect(await violacionesListado({ sort: 'buyer_name' })).not.toHaveLength(0);
    expect(await violacionesListado({ sort: '-created_at' })).toHaveLength(0);
    expect(await violacionesListado({ sort: 'total_ars_cents' })).toHaveLength(0);
  });

  it('limit/offset fuera de rango → violación', async () => {
    expect(await violacionesListado({ limit: 0 })).not.toHaveLength(0);
    expect(await violacionesListado({ limit: 101 })).not.toHaveLength(0);
    expect(await violacionesListado({ offset: -1 })).not.toHaveLength(0);
  });
});

describe('UpdateOrderStatusDto (T7.1, AC-3/AC-6)', () => {
  it("acepta preparing/ready/delivered", async () => {
    for (const status of ['preparing', 'ready', 'delivered']) {
      expect(await violacionesUpdate({ status })).toHaveLength(0);
    }
  });

  it("'cancelled' NUNCA es un valor de tipo válido acá (US-013)", async () => {
    expect(await violacionesUpdate({ status: 'cancelled' })).not.toHaveLength(0);
  });

  it("'new'/'pending_payment' tampoco son destinos válidos del PATCH", async () => {
    expect(await violacionesUpdate({ status: 'new' })).not.toHaveLength(0);
    expect(await violacionesUpdate({ status: 'pending_payment' })).not.toHaveLength(0);
  });

  it('status ausente → violación (requerido)', async () => {
    expect(await violacionesUpdate({})).not.toHaveLength(0);
  });
});

/**
 * fix/US-021-publish-order-anonymization-contract: `anonymized_at`/
 * `anonymization_reason` nacieron en `orders` (US-021 backend, PR #41) pero
 * `AdminOrderDetailDto.fromWithHistory` nunca los proyectaba — el panel no
 * podía pintar AC-5 ("en lugar de los datos del comprador ve una indicación
 * de que fueron anonimizados") con datos reales.
 */
describe('AdminOrderDetailDto.fromWithHistory (US-021 AC-4/AC-5)', () => {
  it('orden nunca anonimizada → anonymized_at y anonymization_reason son null', () => {
    const dto = AdminOrderDetailDto.fromWithHistory(ordenBase(), []);
    expect(dto.anonymized_at).toBeNull();
    expect(dto.anonymization_reason).toBeNull();
  });

  it('orden anonimizada a pedido → expone el momento en ISO y el motivo "requested"', () => {
    const dto = AdminOrderDetailDto.fromWithHistory(
      ordenBase({
        anonymized_at: new Date('2026-09-02T20:31:17.000Z'),
        anonymization_reason: 'requested',
      }),
      [],
    );
    expect(dto.anonymized_at).toBe('2026-09-02T20:31:17.000Z');
    expect(dto.anonymization_reason).toBe('requested');
  });

  it('orden anonimizada por plazo cumplido → distingue "retention_policy" de "requested"', () => {
    const dto = AdminOrderDetailDto.fromWithHistory(
      ordenBase({
        anonymized_at: new Date('2026-09-03T00:00:00.000Z'),
        anonymization_reason: 'retention_policy',
      }),
      [],
    );
    expect(dto.anonymization_reason).toBe('retention_policy');
  });
});
