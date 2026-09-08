import { ProductCard } from './ProductCard';
import { HomeFeaturedViewTracker } from './HomeFeaturedViewTracker';
import type { StorefrontProductListItem } from '@/api/generated/model';

/**
 * Sección de productos destacados del home ("Novedades"/"Más vendidos",
 * US-026). Server Component 100% presentacional: recibe `items` ya resueltos
 * por props — ni `fetch`, ni `homeFeaturedService`, ningún acceso a red
 * (`design.md` D1). El repositorio y la composición en `page.tsx` son,
 * por diseño, tasks de Fase B.
 *
 * Tipa `items` directamente contra `StorefrontProductListItem`
 * (`@/api/generated/model`) — el DTO ya generado y ya verificado por el gate
 * `frontend-codegen-fresh` que hoy rige el listado por categoría (US-002).
 * Ningún tipo provisional nuevo (`design.md` D1).
 *
 * **`items: []` → `null`** (`design.md` D2): la ausencia de datos es
 * responsabilidad de este componente, no de `page.tsx` — así las dos
 * secciones nuevas quedan simétricas (AC-4/AC-5) sin repetir la guarda
 * `items.length > 0 && (...)` en cada sitio de composición.
 *
 * Grilla estática, no carrusel (`design.md` D3): reusa exactamente las
 * clases que ya usa `CategoryPage.tsx` para la grilla de producto.
 *
 * `aria-labelledby` explícito (`design.md` D4): con este change el home pasa
 * a tener tres secciones con nombre (rubros, Novedades, Más vendidos) — la
 * asociación explícita deja que un lector de pantalla que navega por
 * landmarks distinga cada una por su nombre accesible.
 */
export function HomeFeaturedSection({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: StorefrontProductListItem[];
}) {
  if (items.length === 0) return null;

  const headingId = `${id}-heading`;

  return (
    <div className="flex flex-col gap-4">
      <h2 id={headingId} className="text-2xl font-bold text-foreground lg:text-3xl">
        {title}
      </h2>
      <section
        aria-labelledby={headingId}
        className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6"
      >
        {items.map((item) => (
          <ProductCard key={item.slug} item={item} />
        ))}
      </section>
      <HomeFeaturedViewTracker sectionId={id} itemCount={items.length} />
    </div>
  );
}
