'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { esConsultaUtil, normalizar } from './queryGuard';

/** §10.2: ejemplifica en vez de instruir. Muestra qué clase de consulta entiende. */
export const PLACEHOLDER_BUSCADOR =
  "Describí lo que buscás: ej. 'algo para colgar un cuadro en pared dura'";

/** La mitad cliente de AC-5: se explica qué falta, no se dice «inválido». */
export const INVITACION_CONSULTA_CORTA =
  'Contanos un poco más de lo que necesitás para poder buscarlo.';

/**
 * Buscador del top-nav (design-system §7.12, `design.md` D1).
 *
 * Hoja `client` porque necesita `useRouter` y estado del input; se monta desde
 * el layout, que **sigue siendo Server Component**. Ése es el punto de que sea
 * hoja: si el `'use client'` viviera en el layout, `CategoryNav` dejaría de
 * renderizar en servidor y se caería el SEO de US-002.
 *
 * Cada búsqueda es una **navegación** a `/buscar?q=…` (D1): así queda
 * compartible, recargable y con botón atrás funcionando, sin una línea de estado
 * global. Sin dropdown de sugerencias en vivo (OQ-FE-1): el backend no tiene
 * endpoint de autocompletado y un request por tecla se comería la cuota del
 * proveedor que el rate-limit protege.
 *
 * El guard de AC-5 se aplica **antes** de navegar: una consulta corta no gasta
 * una búsqueda. El servidor lo revalida igual, porque a `/buscar?q=a` se llega
 * escribiendo la URL a mano.
 */
export function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rechazo, setRechazo] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!esConsultaUtil(q)) {
      setRechazo(INVITACION_CONSULTA_CORTA);
      // El texto NO se limpia: borrarle lo que escribió lo obliga a empezar de
      // cero justo cuando le estamos pidiendo que agregue algo.
      return;
    }

    setRechazo(null);
    // `URLSearchParams` y no interpolación: una consulta con `&`, `#` o `+`
    // —«caño 1/2 + codo»— rompería la URL armada a mano y llegaría partida.
    const params = new URLSearchParams({ q: normalizar(q) });
    router.push(`/buscar?${params.toString()}`);
  }

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      // Full-width en mobile (OQ-FE-3: sin overlay full-screen).
      className="w-full md:max-w-md"
    >
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 focus-within:shadow-focus">
        <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={PLACEHOLDER_BUSCADOR}
          // Nombre accesible propio: el placeholder desaparece al tipear y no
          // sirve como etiqueta (WCAG 2.1 AA, §11).
          aria-label="Buscar productos"
          aria-describedby={rechazo ? 'search-rechazo' : undefined}
          aria-invalid={rechazo ? true : undefined}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
        />
      </div>
      {rechazo ? (
        <p id="search-rechazo" role="status" className="mt-1 text-sm text-muted">
          {rechazo}
        </p>
      ) : null}
    </form>
  );
}
