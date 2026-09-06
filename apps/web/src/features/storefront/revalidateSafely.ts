import { captureError } from '@/lib/observability/sentry';
import { revalidateCatalog, revalidateProduct } from './revalidate';

/**
 * Puente panel → storefront (design.md D2).
 *
 * Sus fallos son fire-and-forget a propósito: cuando se llama, la mutación
 * **ya fue confirmada** por el backend, así que un error de invalidación de
 * caché nunca se muestra al dueño ni revierte nada — se reporta a
 * observabilidad y la ficha queda cubierta por el safety-net de 1 h del
 * servicio (por eso sigue devolviendo una promesa que nunca rechaza).
 *
 * SÍ se **awaitea** su finalización (éxito o fallo) antes de navegar (US-022):
 * el fetch que dispara la Server Action de invalidación corre en el mismo tab
 * que un `router.push`/navegación posterior del caller — sin esperar a que
 * termine, esa navegación puede cancelar el fetch en pleno vuelo (carrera
 * documentada como ~33% flaky en `e2e/pdp-invalidation.spec.ts`, que un cambio
 * de versión de Chromium/Playwright expuso de forma reproducible). Awaitear
 * la finalización — no su éxito, que sigue sin importarle al caller — cierra
 * esa carrera sin resucitar la semántica de "esperar a que el dueño vea el
 * resultado" que el diseño original evitaba a propósito.
 *
 * Mutar un producto invalida **la ficha y el catálogo**: cambiarle el precio,
 * publicarlo o archivarlo cambia también cómo se ve en la grilla de su
 * categoría (AC-8). Se hace acá, dentro del puente, y NO agregando una llamada
 * en cada sitio de mutación: los tres call-sites del panel (`ProductForm`
 * crear/editar, `ProductActions` publicar/archivar) no cambian, y una acción
 * futura que use el puente hereda la invalidación por construcción en vez de
 * poder olvidarse de ella.
 */
export async function revalidateProductSafely(slug: string): Promise<void> {
  await Promise.all([revalidateProduct(slug), revalidateCatalog()]).catch(captureError);
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
