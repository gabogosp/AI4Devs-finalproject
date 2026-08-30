import { CheckoutModule } from './checkout.module';
import { OrdersRepository } from './orders.repository';

/**
 * T2.2 (US-023) — `PaymentsModule` (Fase 3) necesita importar `CheckoutModule`
 * e inyectar `OrdersRepository` sin re-declararla. Compilar el grafo REAL de
 * `CheckoutModule` en aislamiento arrastra media app (`ProductsModule` ->
 * `CatalogEventsService`, etc. — no son parte de este contrato), así que se
 * verifica el contrato de Nest que importa: el decorador `@Module` declara
 * `OrdersRepository` en `exports`. Si alguien la saca de ahí, este test cae —
 * no es una lectura de texto del archivo, es la metadata que Nest usa en
 * runtime para resolver imports entre módulos.
 */
describe('CheckoutModule exporta OrdersRepository (US-023 T2.2)', () => {
  it('declara OrdersRepository en @Module({ exports })', () => {
    const exportados: unknown[] = Reflect.getMetadata('exports', CheckoutModule) ?? [];
    expect(exportados).toContain(OrdersRepository);
  });

  it('OrdersRepository también sigue en providers (Nest exige declarar antes de exportar)', () => {
    const provistos: unknown[] = Reflect.getMetadata('providers', CheckoutModule) ?? [];
    expect(provistos).toContain(OrdersRepository);
  });
});
