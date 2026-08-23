import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { whatsappHref, WHATSAPP_MESSAGES } from './whatsapp';

// `CategoryNav` es async y pega a la API; acá no es el sujeto bajo prueba.
vi.mock('@/features/storefront/CategoryNav', () => ({ CategoryNav: () => null }));

// El layout monta el `SearchBar` desde US-004, que usa `useRouter`. Sin el
// router del App Router montado, React lanza «invariant expected app router to
// be mounted» y el layout entero no renderiza. No se stubea el SearchBar: la
// gracia de este test es ejercitar el layout REAL, así que se le da lo que el
// layout necesita en vez de recortarlo.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// Se ejercita el LAYOUT, no el componente suelto: así el test falla si alguien
// construye el footer pero se olvida de montarlo, que es el modo de falla real
// de AC-1 ("el enlace está en toda página pública").
const { default: StorefrontLayout } = await import(
  '../../../app/(storefront)/layout'
);

describe('Canal de contacto en toda página pública (AC-1)', () => {
  it('el layout expone un landmark contentinfo', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('el footer ofrece el enlace de WhatsApp con el mensaje genérico', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    const footer = screen.getByRole('contentinfo');
    const link = within(footer).getByRole('link', { name: 'Hablá con nosotros' });

    expect(link).toHaveAttribute(
      'href',
      whatsappHref(WHATSAPP_MESSAGES.general),
    );
  });

  it('el footer muestra los datos del local que hoy son ciertos', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));
    const footer = screen.getByRole('contentinfo');

    expect(
      within(footer).getByText('DSM Refrigeración y Ferretería'),
    ).toBeInTheDocument();
    expect(
      within(footer).getByText(/Av\. Córdoba y Av\. Pueyrredón/),
    ).toBeInTheDocument();
  });

  it('no promete enlaces legales que todavía no existen', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));
    const footer = screen.getByRole('contentinfo');

    // Un enlace legal apuntando a `#` en producción es peor que no tenerlo.
    for (const link of within(footer).getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toBe('#');
    }
  });

  it('el contenido de la página sigue renderizándose junto al footer', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    expect(screen.getByText('contenido')).toBeInTheDocument();
  });
});

describe('Canal de contacto en el header (AC-1)', () => {
  it('el header ofrece el enlace de WhatsApp con el mismo mensaje genérico', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    const header = screen.getByRole('banner');
    expect(
      within(header).getByRole('link', { name: 'WhatsApp' }),
    ).toHaveAttribute('href', whatsappHref(WHATSAPP_MESSAGES.general));
  });

  it('header y footer se distinguen entre sí para un lector de pantalla', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    // Dos entradas, con nombres accesibles DISTINTOS: listar los enlaces de la
    // página no debe mostrar dos filas idénticas sin forma de diferenciarlas.
    const enlaces = screen.getAllByRole('link', {
      name: /WhatsApp|Hablá con nosotros/,
    });
    expect(enlaces).toHaveLength(2);
    expect(new Set(enlaces.map((e) => e.textContent)).size).toBe(2);
  });
  // ── US-017 T3.1 (AC-3) — los enlaces legales ────────────────────────────────
  it('el footer ofrece los dos enlaces legales con sus destinos reales', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    const footer = screen.getByRole('contentinfo');
    expect(
      within(footer).getByRole('link', { name: /política de privacidad/i }),
    ).toHaveAttribute('href', '/legales/privacidad');
    expect(
      within(footer).getByRole('link', { name: /términos y condiciones/i }),
    ).toHaveAttribute('href', '/legales/terminos');
  });

  it('ningún enlace del footer apunta a `#`', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    // El comentario que este cambio reemplazó lo decía: un enlace legal
    // apuntando a `#` en producción es PEOR que no tenerlo (Ley 25.326). Este
    // assert es el que impide que vuelva, acá o en cualquier enlace futuro.
    const hrefs = within(screen.getByRole('contentinfo'))
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((h) => h && h !== '#')).toBe(true);
  });

  it('los legales viven en su propia región, separados del resto del footer', () => {
    render(StorefrontLayout({ children: <p>contenido</p> }));

    // Sin el `nav` con nombre propio, un lector de pantalla lista estos dos
    // enlaces mezclados con el de WhatsApp y no hay forma de saltarlos.
    const legales = within(screen.getByRole('contentinfo')).getByRole(
      'navigation',
      { name: 'Legales' },
    );
    expect(within(legales).getAllByRole('link')).toHaveLength(2);
    // El canal de WhatsApp queda FUERA de esa región (US-018 no se rompe).
    expect(
      within(legales).queryByRole('link', { name: /hablá con nosotros/i }),
    ).toBeNull();
  });
});
