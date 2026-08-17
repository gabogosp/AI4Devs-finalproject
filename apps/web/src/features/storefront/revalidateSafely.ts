import { captureError } from '@/lib/observability/sentry';
import { revalidateProduct } from './revalidate';

/**
 * Puente panel → storefront (design.md D2).
 *
 * Fire-and-forget a propósito: cuando se llama, la mutación **ya fue
 * confirmada** por el backend. Hacer esperar al dueño —o peor, mostrarle un
 * error— porque falló una invalidación de caché sería mentirle sobre lo que
 * pasó. Si falla, se reporta a observabilidad y la ficha queda cubierta por el
 * safety-net de 1 h del servicio.
 */
export function revalidateProductSafely(slug: string): void {
  void revalidateProduct(slug).catch(captureError);
}
