import Link from 'next/link';

/**
 * 404 de una categoría: se sirve con status HTTP 404 REAL (AC-9), así que un
 * buscador no la indexa como página fantasma. Accionable — el cliente sale a
 * navegar en vez de quedar en un callejón (design-system §10.2).
 */
export default function CategoryNotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 p-8">
      <h1 className="text-2xl font-bold text-foreground">
        No encontramos este rubro
      </h1>
      <p className="text-muted">
        Puede que lo hayamos renombrado o que el enlace esté mal escrito.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus:outline-none focus-visible:shadow-focus"
      >
        Ver todos los rubros
      </Link>
    </div>
  );
}
