import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { HomeFeaturedSection } from './HomeFeaturedSection';
import type { StorefrontProductListItem } from '@/api/generated/model';
import { CartProvider } from '@/features/cart/CartProvider';

// `axe-core` no es dependencia directa de este paquete (mismo criterio que
// `apps/web/src/features/reviews/ReviewsSection.a11y.test.tsx`) — forma
// mínima local de lo que este archivo necesita, no el `Result` completo de
// axe-core.
interface AxeViolation {
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
}

expect.extend(toHaveNoViolations);

// Mismo mock que `ProductCard.test.tsx`/`HomeFeaturedSection.test.tsx`:
// `HomeFeaturedSection` renderiza `ProductCard`, que necesita el
// `CartProvider` del layout y el servicio mockeado.
vi.mock('@/features/cart/cartService', () => {
  const vacio = {
    id: null,
    items: [],
    item_count: 0,
    total_quantity: 0,
    total_ars_cents: 0,
    has_blocking_issues: false,
    updated_at: null,
  };
  return {
    cartService: {
      get: vi.fn().mockResolvedValue(vacio),
      setItemQuantity: vi.fn().mockResolvedValue(vacio),
      removeItem: vi.fn(),
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// `region` desactivada: el componente se monta suelto, sin el landmark que
// aporta el layout — mismo criterio que `ReviewsSection.a11y.test.tsx`.
const auditar = async (
  container: HTMLElement,
): Promise<{ violations: AxeViolation[] }> =>
  axe(container, { rules: { region: { enabled: false } } }) as Promise<{
    violations: AxeViolation[];
  }>;

function sinGraves(resultados: { violations: AxeViolation[] }) {
  return resultados.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
}

function item(over: Partial<StorefrontProductListItem> = {}): StorefrontProductListItem {
  return {
    slug: `producto-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Compresor 1HP',
    price_ars_cents: 1250000,
    currency: 'ARS',
    image_url: null,
    in_stock: true,
    ...over,
  };
}

// 8 items — el máximo de una sección (US §7/§8) —, uno de ellos sin stock
// (AC-8) para que el badge "Sin stock" también quede bajo auditoría.
const OCHO_ITEMS: StorefrontProductListItem[] = Array.from({ length: 8 }, (_, i) =>
  item({ slug: `producto-${i}`, name: `Producto ${i}`, in_stock: i !== 3 }),
);

describe('Accesibilidad de HomeFeaturedSection (T-A6)', () => {
  it('con 8 items (uno sin stock) no tiene violaciones serious/critical', async () => {
    const { container } = render(
      <CartProvider>
        <HomeFeaturedSection id="novedades" title="Novedades" items={OCHO_ITEMS} />
      </CartProvider>,
    );

    expect(sinGraves(await auditar(container))).toEqual([]);
  });
});
