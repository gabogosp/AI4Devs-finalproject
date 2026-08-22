import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductPurchase } from './ProductPurchase';

describe('ProductPurchase — con stock (AC-3)', () => {
  it('ofrece el CTA de compra como disparador, deshabilitado hasta US-007', () => {
    render(<ProductPurchase inStock productName="Heladera exhibidora" />);

    const cta = screen.getByRole('button', { name: 'Agregar al carrito' });
    expect(cta).toBeInTheDocument();
    expect(cta).toBeDisabled();
  });

  it('indica disponibilidad con texto, no sólo con color', () => {
    render(<ProductPurchase inStock productName="Heladera exhibidora" />);

    expect(screen.getByText('En stock')).toBeInTheDocument();
  });

  it('ofrece el canal de WhatsApp como CTA de compra del MVP (sin carrito aún)', () => {
    render(<ProductPurchase inStock productName="Heladera exhibidora" />);

    const link = screen.getByRole('link', { name: /Comprar por WhatsApp/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('https://wa.me/'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('precarga el mensaje de WhatsApp con el nombre del producto (con stock)', () => {
    render(<ProductPurchase inStock productName="Heladera exhibidora" />);

    const href = screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href') ?? '';
    expect(decodeURIComponent(href)).toContain('Heladera exhibidora');
  });
});

describe('ProductPurchase — sin stock (AC-4)', () => {
  it('NO renderiza el botón de compra en el DOM', () => {
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" />);

    // No basta con que esté deshabilitado: el §7.3 exige reemplazarlo.
    expect(
      screen.queryByRole('button', { name: 'Agregar al carrito' }),
    ).not.toBeInTheDocument();
  });

  it('muestra el badge "Sin stock" con texto', () => {
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" />);

    expect(screen.getByText('Sin stock')).toBeInTheDocument();
  });

  it('ofrece el canal WhatsApp con nombre accesible y enlace a wa.me', () => {
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" />);

    const link = screen.getByRole('link', { name: /Avisame por WhatsApp/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('https://wa.me/'));
    // El nombre accesible viene del texto, no sólo del ícono.
    expect(link).toHaveTextContent('Avisame por WhatsApp');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('precarga el mensaje de WhatsApp con el nombre del producto', () => {
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" />);

    const href = screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href') ?? '';
    expect(decodeURIComponent(href)).toContain('Heladera exhibidora');
  });

  it('explica la situación con el copy del design-system §10.2', () => {
    render(<ProductPurchase inStock={false} productName="Heladera exhibidora" />);

    expect(
      screen.getByText(
        'Sin stock por ahora. Escribinos por WhatsApp y te avisamos cuando vuelva.',
      ),
    ).toBeInTheDocument();
  });
});
