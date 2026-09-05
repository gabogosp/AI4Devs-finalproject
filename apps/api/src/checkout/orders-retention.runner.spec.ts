import { OrdersRetentionRunner } from './orders-retention.runner';
import { OrdersRetentionService } from './orders-retention.service';

/**
 * T3.3 — el runner nunca puede impedir que la API levante, ni siquiera si el
 * barrido falla.
 */
describe('OrdersRetentionRunner', () => {
  it('al construir el módulo, corre runRetentionSweep() una vez', async () => {
    const sweep = jest.fn().mockResolvedValue(2);
    const service = { runRetentionSweep: sweep } as unknown as OrdersRetentionService;
    const runner = new OrdersRetentionRunner(service);

    await runner.onApplicationBootstrap();

    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('si el servicio lanza, el error se loguea y el método resuelve igual (no propaga)', async () => {
    const sweep = jest.fn().mockRejectedValue(new Error('Postgres caído'));
    const service = { runRetentionSweep: sweep } as unknown as OrdersRetentionService;
    const runner = new OrdersRetentionRunner(service);
    jest.spyOn(runner['logger'], 'error').mockImplementation(() => undefined);

    await expect(runner.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(runner['logger'].error).toHaveBeenCalledWith(
      expect.stringContaining('Postgres caído'),
    );
  });
});
