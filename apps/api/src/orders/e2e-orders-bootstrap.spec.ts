import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';

/**
 * T7.3 — `OrdersModule` se registra en `AppModule` directamente, con
 * resolución de dependencias circular-safe por construcción (design.md §D1:
 * `orders → checkout` es dirección acíclica — no hace falta ninguna
 * referencia diferida). Este test falla si hay un ciclo que Nest no puede
 * resolver al compilar el módulo raíz completo.
 */
describe('AppModule arranca con OrdersModule (T7.3)', () => {
  it('Test.createTestingModule({imports:[AppModule]}).compile() no lanza', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.close();
  });
});
