import { CheckoutModule } from './checkout.module';
import { OrdersRepository } from './orders.repository';

/**
 * T3.2 — wiring de `exports`, sin bootear el DI container completo: compilar
 * `CheckoutModule` de punta a punta (vía `Test.createTestingModule`) requiere
 * config global (`ConfigService` para `ThrottlerModule`) que sólo existe en
 * `AppModule` — fuera de alcance de este task. Se lee la metadata real que
 * Nest adjunta al decorator `@Module()` (la misma que el framework usa para
 * resolver) en vez de un `grep` de texto: falla si `OrdersRepository` falta
 * en `exports`, o si aparece duplicado en cualquiera de los dos arrays.
 */
describe('CheckoutModule — exports (US-012 T3.2)', () => {
  it('OrdersRepository está en `exports` exactamente una vez', () => {
    const exports: unknown[] = Reflect.getMetadata('exports', CheckoutModule) ?? [];
    expect(exports.filter((e) => e === OrdersRepository)).toHaveLength(1);
  });

  it('OrdersRepository está en `providers` exactamente una vez (no duplicado)', () => {
    const providers: unknown[] = Reflect.getMetadata('providers', CheckoutModule) ?? [];
    expect(providers.filter((p) => p === OrdersRepository)).toHaveLength(1);
  });
});
