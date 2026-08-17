/**
 * Skeleton con la **forma** de la ficha (imagen cuadrada + título + precio +
 * CTA), no un spinner: el layout no salta cuando llega el contenido
 * (`frontend-resilience-patterns` #12).
 */
export default function ProductLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="mx-auto flex max-w-5xl flex-col gap-6 p-4 lg:flex-row lg:gap-10 lg:p-8"
    >
      <span className="sr-only">Cargando el producto…</span>
      <div className="aspect-square w-full animate-pulse rounded-lg bg-gray-100 lg:w-1/2" />
      <div className="flex w-full flex-col gap-4 lg:w-1/2">
        <div className="h-8 w-3/4 animate-pulse rounded bg-gray-100" />
        <div className="h-10 w-1/3 animate-pulse rounded bg-gray-100" />
        <div className="h-11 w-48 animate-pulse rounded-md bg-gray-100" />
      </div>
    </div>
  );
}
