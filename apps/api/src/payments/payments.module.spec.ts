import { INestApplication } from '@nestjs/common';
import { bootTestApp } from '../../test/e2e-app';
import { CheckoutModule } from '../checkout/checkout.module';
import { StockModule } from '../stock/stock.module';
import { ConfirmOrderService } from './confirm-order.service';
import { PaymentsModule } from './payments.module';

/**
 * T13.1 — wiring final: la app arranca sin errores de DI con todos los
 * providers/controllers nuevos registrados (`MercadoPagoClient` incluido —
 * T8.2 encontró y corrigió el bug real de wiring de este módulo).
 * `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` vienen de `jest.setup.js`/env de test.
 */
describe('PaymentsModule (T13.1)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('arranca sin errores de DI, con todos los providers/controllers nuevos registrados', async () => {
    app = await bootTestApp([CheckoutModule, StockModule, PaymentsModule]);

    expect(app.get(ConfirmOrderService)).toBeInstanceOf(ConfirmOrderService);
  });
});
