import { INestApplication } from '@nestjs/common';
import { bootTestApp } from '../../test/e2e-app';
import { PaymentsModule } from './payments.module';
import { StockModule } from '../stock/stock.module';

/**
 * T4.2 — arranca `StockModule` + `PaymentsModule` con el mismo helper que
 * usa el resto de la suite (`bootTestApp`, mismo `configureApp` que
 * producción). Si el wiring (imports acíclicos, sin `forwardRef`) estuviera
 * mal, `bootTestApp` lanza acá — no es un test que sólo confirme que las
 * clases existen.
 */
describe('Bootstrap de StockModule + PaymentsModule (US-023 T4.2)', () => {
  let app: INestApplication;

  it('arranca sin lanzar', async () => {
    app = await bootTestApp([StockModule, PaymentsModule]);
    expect(app).toBeDefined();
  });

  afterAll(async () => {
    await app?.close();
  });
});
