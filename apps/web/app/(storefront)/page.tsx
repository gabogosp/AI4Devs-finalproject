import type { Metadata } from 'next';
import Link from 'next/link';
import { categoriesStorefrontService } from '@/features/storefront/categoriesStorefrontService';

/**
 * Home pública del storefront (US-002 AC-1).
 *
 * Server Component: la grilla de rubros y subrubros está en el HTML servido,
 * que es lo que la hace indexable. El buscador es `Deferred: US-004`.
 */
export const metadata: Metadata = {
  title: 'DSM Refrigeración y Ferretería',
  description:
    'Ferretería y refrigeración en CABA. Comprá online y retirá en el local.',
};

export default async function StorefrontHome() {
  // Si el árbol cae, la home se sirve igual con el claim: perder los rubros no
  // justifica un 500 en la puerta de entrada del sitio (resilience #10).
  const rubros = await categoriesStorefrontService.getTree().catch(() => []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-foreground">
          DSM Refrigeración y Ferretería
        </h1>
        <p className="text-muted">
          Comprá online y retirá en nuestro local de Av. Córdoba y Av. Pueyrredón.
        </p>
      </header>

      {rubros.length > 0 && (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
          {rubros.map((rubro) => (
            <article key={rubro.slug} className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">
                <Link
                  href={`/categorias/${rubro.slug}`}
                  className="focus:outline-none focus-visible:shadow-focus"
                >
                  {rubro.name}
                </Link>
              </h2>
              {rubro.children.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm text-muted">
                  {rubro.children.map((sub) => (
                    <li key={sub.slug}>
                      <Link
                        href={`/categorias/${sub.slug}`}
                        className="focus:outline-none focus-visible:shadow-focus"
                      >
                        {sub.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
