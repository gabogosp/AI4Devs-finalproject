import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { whatsappHref, WHATSAPP_MESSAGES } from './whatsapp';

// `CategoryNav` es async y pega a la API; acá no es el sujeto bajo prueba.
vi.mock('@/features/storefront/CategoryNav', () => ({ CategoryNav: () => null }));

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
});

