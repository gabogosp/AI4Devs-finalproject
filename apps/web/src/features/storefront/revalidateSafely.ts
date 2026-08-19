import { captureError } from '@/lib/observability/sentry';
import { revalidateCatalog, revalidateProduct } from './revalidate';

/**
 * Puente panel → storefront (design.md D2).
 *
 * Fire-and-forget a propósito: cuando se llama, la mutación **ya fue
 * confirmada** por el backend. Hacer esperar al dueño —o peor, mostrarle un
 * error— porque falló una invalidación de caché sería mentirle sobre lo que
 * pasó. Si falla, se reporta a observabilidad y la ficha queda cubierta por el
 * safety-net de 1 h del servicio.
 *
 * Mutar un producto invalida **la ficha y el catálogo**: cambiarle el precio,
 * publicarlo o archivarlo cambia también cómo se ve en la grilla de su
 * categoría (AC-8). Se hace acá, dentro del puente, y NO agregando una llamada
 * en cada sitio de mutación: los tres call-sites del panel (`ProductForm`
 * crear/editar, `ProductActions` publicar/archivar) no cambian, y una acción
 * futura que use el puente hereda la invalidación por construcción en vez de
 * poder olvidarse de ella.
 */
export function revalidateProductSafely(slug: string): void {
  void Promise.all([revalidateProduct(slug), revalidateCatalog()]).catch(captureError);
}

/**
 * Para mutaciones que afectan la **estructura** del catálogo, no un producto:
 * alta o edición de una categoría (design.md D2).
 *
 * Sin esto, una categoría recién creada tardaría hasta el TTL de 1 h en
 * aparecer en la navegación y en el sitemap — y su página podría seguir
 * sirviendo el 404 que quedó cacheado antes de que existiera.
 */
export function revalidateCatalogSafely(): void {
  void revalidateCatalog().catch(captureError);
}
