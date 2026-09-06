import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

// `axe-core` no es dependencia directa de este paquete (mismo criterio que
// `apps/web/src/features/order-history/a11y.test.tsx`) — forma mínima local
// de lo que este archivo necesita, no el `Result` completo de axe-core.
interface AxeViolation {
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
}

import type { AsyncState } from '@/lib/async';
import { ReviewsSection } from './ReviewsSection';
import type { ReviewViewModel, ViewerReviewState } from './types.provisional';

expect.extend(toHaveNoViolations);

// `region` desactivada: el componente se monta suelto, sin el landmark que
// aporta el layout — mismo criterio que `features/order-history/a11y.test.tsx`.
const auditar = async (
  container: HTMLElement,
): Promise<{ violations: AxeViolation[] }> =>
  axe(container, { rules: { region: { enabled: false } } }) as Promise<{
    violations: AxeViolation[];
  }>;

const SUMMARY = { average: 4.2, count: 5 };

function otherReview(): ReviewViewModel {
  return {
    id: 'r2',
    authorName: 'Bruno Díaz',
    rating: 5,
    comment: 'Impecable',
    createdAt: '2026-08-29T10:00:00.000Z',
    isOwn: false,
    hidden: false,
  };
}

function ownReview(): ReviewViewModel {
  return {
    id: 'own-1',
    authorName: 'Vos',
    rating: 3,
    comment: 'Buen producto',
    createdAt: '2026-08-30T10:00:00.000Z',
    isOwn: true,
    hidden: false,
  };
}

async function auditarViewerState(
  viewerState: ViewerReviewState,
  reviews: AsyncState<ReviewViewModel[]> = { status: 'success', data: [otherReview()] },
) {
  const { container } = render(
    <ReviewsSection
      viewerState={viewerState}
      summary={SUMMARY}
      reviews={reviews}
      onSubmitReview={vi.fn()}
      submitState={{ status: 'idle' }}
    />,
  );
  return auditar(container);
}

function sinGraves(resultados: { violations: AxeViolation[] }) {
  return resultados.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
}

describe('Accesibilidad de ReviewsSection (T-A10) — los 4 viewerState + carga/error', () => {
  it("'guest' no tiene violaciones serious/critical", async () => {
    expect(sinGraves(await auditarViewerState({ kind: 'guest' }))).toEqual([]);
  });

  it("'ineligible' no tiene violaciones serious/critical", async () => {
    expect(sinGraves(await auditarViewerState({ kind: 'ineligible' }))).toEqual([]);
  });

  it("'eligible-new' no tiene violaciones serious/critical", async () => {
    expect(sinGraves(await auditarViewerState({ kind: 'eligible-new' }))).toEqual([]);
  });

  it("'eligible-editing' no tiene violaciones serious/critical", async () => {
    expect(
      sinGraves(await auditarViewerState({ kind: 'eligible-editing', ownReview: ownReview() })),
    ).toEqual([]);
  });

  it("reviews en 'loading' no tiene violaciones serious/critical", async () => {
    expect(
      sinGraves(await auditarViewerState({ kind: 'ineligible' }, { status: 'loading' })),
    ).toEqual([]);
  });

  it("reviews en 'error' no tiene violaciones serious/critical", async () => {
    expect(
      sinGraves(
        await auditarViewerState(
          { kind: 'ineligible' },
          { status: 'error', error: { kind: 'network', message: 'red' } },
        ),
      ),
    ).toEqual([]);
  });
});
