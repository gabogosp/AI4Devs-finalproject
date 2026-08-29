'use client';

import { useSession } from './SessionProvider';

/**
 * Contenido de `/mi-cuenta` (US-014 T2.6, OQ-FE-2 opción (b): página mínima).
 *
 * Es el destino de la sesión: sin una pantalla propia, AC-2 sólo se
 * demostraría en el header. Muestra lo que el servidor dice de la persona, y
 * declara honestamente lo que todavía no existe en vez de insinuarlo.
 */
export function AccountPanel() {
  const { state, logout } = useSession();
  if (state.kind !== 'authenticated') return null;

  const { customer } = state;
  const alta = new Date(customer.created_at).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col gap-6">
      <dl className="flex flex-col gap-3">
        <div>
          <dt className="text-xs uppercase text-muted">Nombre</dt>
          <dd className="text-sm text-fg">{customer.name}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">Email</dt>
          <dd className="text-sm text-fg">{customer.email}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted">Cliente desde</dt>
          <dd className="text-sm text-fg">{alta}</dd>
        </div>
      </dl>

      {/* Placeholder honesto: el historial es de US-015. Decir "próximamente"
          es mejor que una sección vacía que parece rota. */}
      <section className="rounded-md border border-border p-4">
        <h2 className="text-sm font-medium text-fg">Tus compras</h2>
        <p className="text-sm text-muted">Próximamente.</p>
      </section>

      <button
        type="button"
        onClick={() => void logout()}
        className="self-start text-sm underline focus:outline-none focus-visible:shadow-focus"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
