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
    <div className="flex flex-col">
      {/* Hero — puerta de entrada de la tienda. */}
      <section className="bg-accent-subtle">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-8 py-12 lg:py-16">
          <span className="w-fit rounded-full bg-accent-strong/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent-strong">
            Refrigeración · Ferretería · Electricidad
          </span>
          <h1 className="max-w-2xl text-3xl font-bold text-foreground lg:text-5xl">
            DSM Refrigeración y Ferretería
          </h1>
          <p className="max-w-2xl text-lg font-medium text-foreground lg:text-xl">
            Todo para tu heladera, tu obra y tu taller.
          </p>
          <p className="max-w-xl text-muted">
            Comprá online y retirá en nuestro local de Av. Córdoba y Av. Pueyrredón.
            Asesoramiento por WhatsApp en cada producto.
          </p>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
        {rubros.length > 0 && (
          <>
            <h2 className="text-xl font-semibold text-foreground">Explorá por rubro</h2>
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
              {rubros.map((rubro) => (
                <article
                  key={rubro.slug}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <h3 className="text-lg font-semibold">
                    <Link
                      href={`/categorias/${rubro.slug}`}
                      className="text-foreground transition-colors hover:text-accent-strong focus:outline-none focus-visible:shadow-focus"
                    >
                      {rubro.name}
                      <span aria-hidden="true" className="ml-1">→</span>
                    </Link>
                  </h3>
                  {rubro.children.length > 0 && (
                    <ul className="flex flex-col gap-1.5 text-sm text-muted">
                      {rubro.children.map((sub) => (
                        <li key={sub.slug}>
                          <Link
                            href={`/categorias/${sub.slug}`}
                            className="transition-colors hover:text-accent-strong focus:outline-none focus-visible:shadow-focus"
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
          </>
        )}
      </div>
    </div>
  );
}
