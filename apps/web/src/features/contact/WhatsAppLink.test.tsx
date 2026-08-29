import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WhatsAppLink } from './WhatsAppLink';
import { whatsappHref } from './whatsapp';

describe('WhatsAppLink', () => {
  it('el nombre accesible es exactamente el label, sin aporte del ícono', () => {
    render(<WhatsAppLink label="Hablá con nosotros" />);

    // Matcher exacto a propósito: si el ícono dejara de ser `aria-hidden` y
    // aportara nombre accesible, este assert falla.
    expect(
      screen.getByRole('link', { name: 'Hablá con nosotros' }),
    ).toBeInTheDocument();
  });

  it('abre en pestaña nueva sin exponer window.opener', () => {
    render(<WhatsAppLink label="Hablá con nosotros" />);
    const link = screen.getByRole('link', { name: 'Hablá con nosotros' });

    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);
  });

  it('delega la composición del href al constructor único', () => {
    render(<WhatsAppLink label="Consultar" message="hola" />);

    expect(screen.getByRole('link', { name: 'Consultar' })).toHaveAttribute(
      'href',
      whatsappHref('hola'),
    );
  });

  it('con mensaje el href difiere del href sin mensaje', () => {
    const { rerender } = render(<WhatsAppLink label="A" />);
    const sinMensaje = screen.getByRole('link', { name: 'A' }).getAttribute('href');

    rerender(<WhatsAppLink label="A" message="consulta" />);
    const conMensaje = screen.getByRole('link', { name: 'A' }).getAttribute('href');

    expect(conMensaje).not.toBe(sinMensaje);
  });

  it('el área táctil cumple el mínimo de 44px (WCAG 2.1 AA)', () => {
    render(<WhatsAppLink label="Hablá con nosotros" />);

    expect(
      screen.getByRole('link', { name: 'Hablá con nosotros' }).className,
    ).toContain('min-h-[44px]');
  });
});
