import { CheckoutModule } from './checkout.module';
import { OrdersRepository } from './orders.repository';

/**
 * T3.2 (US-012) / T2.2 (US-023) — wiring de `exports`, sin bootear el DI
 * container completo: compilar `CheckoutModule` de punta a punta (vía
 * `Test.createTestingModule`) requiere config global (`ConfigService` para
 * `ThrottlerModule`) que sólo existe en `AppModule`, y arrastra media app
 * (`ProductsModule` -> `CatalogEventsService`, etc.) que no es parte de este
 * contrato. Se lee la metadata real que Nest adjunta al decorator `@Module()`
 * (la misma que el framework usa para resolver imports entre módulos) en vez
 * de un `grep` de texto: falla si `OrdersRepository` falta en `exports`, o si
 * aparece duplicado en cualquiera de los dos arrays. `OrdersModule` (US-012)
 * y `PaymentsModule` (US-023) dependen ambos de este contrato para inyectar
 * `OrdersRepository` sin re-declararla.
 */
describe('CheckoutModule exporta OrdersRepository (US-012 T3.2 / US-023 T2.2)', () => {
  it('OrdersRepository está en `exports` exactamente una vez', () => {
    const exports: unknown[] = Reflect.getMetadata('exports', CheckoutModule) ?? [];
    expect(exports.filter((e) => e === OrdersRepository)).toHaveLength(1);
  });

  it('OrdersRepository está en `providers` exactamente una vez (no duplicado)', () => {
    const providers: unknown[] = Reflect.getMetadata('providers', CheckoutModule) ?? [];
    expect(providers.filter((p) => p === OrdersRepository)).toHaveLength(1);
  });
});
