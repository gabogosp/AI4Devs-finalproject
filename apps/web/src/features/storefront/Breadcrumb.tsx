import Link from 'next/link';

export type BreadcrumbItem = {
  name: string;
  /** El ítem actual (el último) va SIN href: no se enlaza a sí mismo. */
  href?: string;
};

/**
 * Ruta de navegación reusable (design-system §11; US-002 AC-2).
 *
 * Server Component: son links, no hay interacción. El último ítem lleva
 * `aria-current="page"` y no es un link — enlazar la página actual confunde a
 * lectores de pantalla y no aporta navegación.
 */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Ruta de navegación">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((item, i) => (
          <li key={item.href ?? `current-${i}`} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">›</span>}
            {item.href ? (
              <Link
                href={item.href}
                className="focus:outline-none focus-visible:shadow-focus"
              >
                {item.name}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
