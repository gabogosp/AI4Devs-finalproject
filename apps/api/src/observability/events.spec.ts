import { Logger } from '@nestjs/common';
import { CatalogEventsService } from './catalog-events.service';

describe('CatalogEventsService (events)', () => {
  it('emit product.published loguea payload estructurado y cuenta', () => {
    const spy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const service = new CatalogEventsService();

    service.emit('product.published', 'prod-1', 'admin-1', 'trace-9');

    expect(service.count('product.published')).toBe(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'product.published',
        entity_id: 'prod-1',
        admin_user_id: 'admin-1',
        trace_id: 'trace-9',
      }),
    );
    spy.mockRestore();
  });

  it('acumula el contador por tipo de evento', () => {
    const service = new CatalogEventsService();
    service.emit('product.created', 'a');
    service.emit('product.created', 'b');
    service.emit('category.created', 'c');
    expect(service.count('product.created')).toBe(2);
    expect(service.count('category.created')).toBe(1);
    expect(service.count('product.archived')).toBe(0);
  });

  it('admin_user_id por defecto es el pseudónimo "admin"', () => {
    const spy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    new CatalogEventsService().emit('product.created', 'x');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ admin_user_id: 'admin' }),
    );
    spy.mockRestore();
  });
});
