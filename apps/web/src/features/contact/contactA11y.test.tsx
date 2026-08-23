import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

vi.mock('@/features/storefront/CategoryNav', () => ({ CategoryNav: () => null }));

// El layout monta el `SearchBar` desde US-004, que usa `useRouter`. Sin el router
// del App Router montado, React lanza «invariant expected app router to be
// mounted» y el layout entero no renderiza.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { default: StorefrontLayout } = await import(
  '../../../app/(storefront)/layout'
);

/**
 * WCAG 2.1 AA sobre las dos superficies que agrega US-018 (design-system §11).
 *
 * **Límite conocido, aprendido en US-003**: jsdom no calcula contraste. El fallo
 * del `text-muted` (4.39:1 contra el 4.5:1 que exige AA) lo encontró axe en
 * un browser real, no un test como éste. Acá se cubren nombres accesibles,
 * landmarks y roles; el contraste de los tokens `accent-strong` sobre blanco ya
 * está verificado en `design-system.md` §2.4, y la verificación en browser real
 * pertenece a QA.
 */
describe('a11y — header y footer de contacto', () => {
  it('axe no encuentra violaciones en el árbol del layout', async () => {
    const { container } = render(StorefrontLayout({ children: <p>contenido</p> }));

    expect(await axe(container)).toHaveNoViolations();
  });

  it('cada enlace de contacto tiene nombre accesible propio', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    for (const nombre of ['WhatsApp', 'Hablá con nosotros']) {
      expect(screen.getByRole('link', { name: nombre })).toHaveAccessibleName();
    }
  });

  it('los enlaces de contacto cumplen el área táctil de 44px', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    for (const nombre of ['WhatsApp', 'Hablá con nosotros']) {
      expect(screen.getByRole('link', { name: nombre }).className).toContain(
        'min-h-[44px]',
      );
    }
  });

  it('el layout expone los dos landmarks, banner y contentinfo', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  // ── US-017 T3.2 — los enlaces legales que T3.1 agregó al footer ─────────────
  it('los dos enlaces legales tienen nombre accesible propio y área táctil ≥44px', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    const legales = within(screen.getByRole('contentinfo')).getByRole(
      'navigation',
      { name: 'Legales' },
    );
    const enlaces = within(legales).getAllByRole('link');

    // Nombres DISTINTOS: listar los enlaces de la página no debe mostrar dos
    // filas indistinguibles (mismo criterio que US-018 aplicó al de WhatsApp).
    expect(new Set(enlaces.map((a) => a.textContent)).size).toBe(2);

    // Área táctil del design-system §11. jsdom no calcula layout, así que lo
    // verificable es la CLASE declarada — se asserta explícitamente en vez de
    // fingir que se midió el pixel.
    enlaces.forEach((a) => {
      expect(a.className).toContain('min-h-[44px]');
      expect(a.className).toContain('focus-visible:shadow-focus');
    });
  });

  it('el footer con los enlaces legales sigue sin violaciones de axe', async () => {
    const { container } = render(
      StorefrontLayout({ children: <p>contenido</p> }),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
