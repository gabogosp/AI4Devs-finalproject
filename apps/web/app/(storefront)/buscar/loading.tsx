import { SearchSkeleton } from '@/features/search/SearchSkeleton';

/**
 * El **único** `loading.tsx` de todo `(storefront)`, y acotado a este segmento a
 * propósito (`design.md` D3).
 *
 * El resto del storefront no tiene ninguno por una razón dura (US-003
 * `design.md` D1.bis, gap F59): la boundary de Suspense transmite el shell con
 * el status **200 ya comprometido**, y eso vuelve imposible un `notFound()`
 * real — el soft-200 indexable que US-002 AC-9 prohíbe. Ponerlo un nivel arriba
 * rompería el 404 de la ficha, que ya está en producción.
 *
 * Acá esa objeción no aplica: `/buscar` **nunca** llama a `notFound()` —una
 * consulta siempre produce una página, con resultados, con reserva, sin señal o
 * degradada— así que el 200 es el status correcto en todos los casos. Y el
 * beneficio sí aplica: §10.1 pide skeleton mientras se busca, que es lo que un
 * `loading.tsx` da gratis durante la navegación.
 */
export default function BuscarLoading() {
  return (
    <div className="mx-auto max-w-5xl p-4">
      <SearchSkeleton />
    </div>
  );
}
