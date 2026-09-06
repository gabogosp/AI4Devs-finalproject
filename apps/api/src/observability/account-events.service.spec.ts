import { MetricsService } from './metrics.service';
import { AccountEventName, AccountEventsService } from './account-events.service';

/**
 * T2.2 — el evento de borrado de cuenta (design.md §Approach). Igual que
 * `orders-history-events.spec.ts`: lo central es que el payload NUNCA
 * contenga PII y que `customerId` nunca sea dimensión de métrica.
 */
describe('AccountEventsService (US-020 T2.2)', () => {
  const LOS_DOS: AccountEventName[] = ['account.deleted', 'account.deletion_blocked'];

  it('los 2 nombres se emiten y se cuentan por nombre', async () => {
    const metrics = new MetricsService();
    const events = new AccountEventsService(metrics);

    for (const nombre of LOS_DOS) events.emit(nombre, 'cust-1');

    for (const nombre of LOS_DOS) {
      expect(await events.count(nombre)).toBe(1);
    }
  });

  it('el valor sale por el REGISTRO de Prometheus (dsm_account_events_total)', async () => {
    const metrics = new MetricsService();
    const events = new AccountEventsService(metrics);

    events.emit('account.deleted', 'cust-1');

    const expuesto = await metrics.render();

    expect(expuesto).toContain('dsm_account_events_total');
    expect(expuesto).toMatch(/dsm_account_events_total\{event="account\.deleted"\} 1/);
  });

  it('account.deleted con anonymized_orders: loguea event, entity_id, trace_id, anonymized_orders — sin ningún dato de contacto', async () => {
    const events = new AccountEventsService(new MetricsService());
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emit('account.deleted', 'cust-42', 'trace-abc', { anonymized_orders: 3 });

    expect(Object.keys(capturado[0]).sort()).toEqual([
      'anonymized_orders',
      'entity_id',
      'event',
      'trace_id',
    ]);
    expect(capturado[0]).toMatchObject({
      event: 'account.deleted',
      entity_id: 'cust-42',
      trace_id: 'trace-abc',
      anonymized_orders: 3,
    });

    // Guardián explícito (Verify de T2.2): falla si algún día se cuela PII directa.
    const claves = Object.keys(capturado[0]);
    expect(claves).not.toContain('name');
    expect(claves).not.toContain('email');
    expect(claves).not.toContain('phone');
  });

  it('el contador de account.deleted se incrementa con la emisión de arriba', async () => {
    const metrics = new MetricsService();
    const events = new AccountEventsService(metrics);

    events.emit('account.deleted', 'cust-42', undefined, { anonymized_orders: 3 });

    expect(await events.count('account.deleted')).toBe(1);
  });

  it('funciona sin MetricsService: la observabilidad no condiciona instanciar', async () => {
    const events = new AccountEventsService();

    expect(() => events.emit('account.deleted', 'cust-1')).not.toThrow();
    expect(await events.count('account.deleted')).toBe(0);
  });
});
