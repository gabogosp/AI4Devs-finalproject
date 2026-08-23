/**
 * Skeleton de resultados (design-system §10.1: skeleton, no spinner).
 *
 * Un spinner dice «esperá» y nada más. El skeleton dice además **qué** va a
 * aparecer y dónde, así que la página no salta cuando llegan los datos.
 *
 * El detalle que importa es de accesibilidad: las cajas son decorativas y van
 * `aria-hidden`. Sin eso, un lector de pantalla recorre una grilla de elementos
 * vacíos y anuncia contenido que no existe — le hace creer que ya hay
 * resultados. El único anuncio real es el `role="status"`, que dice que se está
 * buscando y se reemplaza solo cuando llega la respuesta.
 */
export function SearchSkeleton({ items = 8 }: { items?: number }) {
  return (
    <div>
      <p role="status" className="text-sm text-muted">
        Buscando…
      </p>
      <div
        aria-hidden="true"
        className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4"
      >
        {Array.from({ length: items }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-border p-3"
          >
            <div className="aspect-square w-full animate-pulse rounded-lg bg-gray-100" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
