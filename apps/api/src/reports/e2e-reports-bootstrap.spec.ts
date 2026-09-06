import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';

/**
 * T6.3 — `AppModule` compila con `ReportsModule` importado, sin referencias
 * circulares entre módulos.
 */
describe('AppModule + ReportsModule (e2e-reports-bootstrap)', () => {
  it('el contenedor completo compila sin lanzar', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    await app.close();
  });
});
