import Link from 'next/link';

/**
 * 404 de la ficha: se sirve con status HTTP 404 real (AC-7/AC-8), así que un
 * buscador no la indexa. Accionable — el cliente no queda en un callejón sin
 * salida (design-system §10.2).
 */
export default function ProductNotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 p-8">
      <h1 className="text-2xl font-bold text-foreground">
        No encontramos este producto
      </h1>
      <p className="text-muted">
        Puede que ya no esté disponible o que el enlace esté mal escrito.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus:outline-none focus-visible:shadow-focus"
      >
        Ver el catálogo
      </Link>
    </div>
  );
}
