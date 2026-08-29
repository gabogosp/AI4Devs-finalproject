import Link from 'next/link';

/**
 * Paginación de la grilla de categoría (AC-3, design.md D3).
 *
 * Son `<a href>` reales y no botones con JS: la paginación tiene que ser
 * navegable sin JavaScript e **indexable** — un crawler sigue links, no
 * handlers de click.
 */
export function Pagination({
  slug,
  current,
  total,
  pageSize,
}: {
  slug: string;
  current: number;
  total: number;
  pageSize: number;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage <= 1) return null;

  // La página 1 vive en `/categorias/{slug}` SIN `?page=1`: una sola URL
  // canónica para el mismo contenido (design.md D4).
  const href = (page: number) =>
    page <= 1 ? `/categorias/${slug}` : `/categorias/${slug}?page=${page}`;

  const pages = Array.from({ length: lastPage }, (_, i) => i + 1);

  return (
    <nav aria-label="Paginación">
      <ul className="flex flex-wrap items-center gap-2">
        {current > 1 && (
          <li>
            <Link
              href={href(current - 1)}
              rel="prev"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 text-sm focus:outline-none focus-visible:shadow-focus"
            >
              Anterior
            </Link>
          </li>
        )}

        {pages.map((page) => (
          <li key={page}>
            <Link
              href={href(page)}
              aria-current={page === current ? 'page' : undefined}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 text-sm focus:outline-none focus-visible:shadow-focus aria-[current=page]:font-bold aria-[current=page]:text-foreground"
            >
              {page}
            </Link>
          </li>
        ))}

        {current < lastPage && (
          <li>
            <Link
              href={href(current + 1)}
              rel="next"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 text-sm focus:outline-none focus-visible:shadow-focus"
            >
              Siguiente
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}

/**
 * Normaliza el `page` de la query. Cualquier cosa que no sea un entero ≥ 1
 * —`abc`, `0`, `-1`, `2.5`— cae a 1 y responde 200: son URLs que existen, sólo
 * que mal escritas, y devolver 404 por un typo sería hostil.
 */
export function normalizePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}
