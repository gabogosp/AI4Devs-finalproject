import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pagination, normalizePage } from './Pagination';

describe('normalizePage (AC-3)', () => {
  it.each([
    ['2', 2],
    ['1', 1],
    [undefined, 1],
    // Una URL mal escrita existe: se sirve la página 1 con 200, no un 404
    // hostil por un typo.
    ['abc', 1],
    ['0', 1],
    ['-1', 1],
    ['2.5', 2],
  ])('normaliza %j → %i', (raw, expected) => {
    expect(normalizePage(raw as string | undefined)).toBe(expected);
  });
});

describe('Pagination (AC-3)', () => {
  it('no se renderiza cuando todo entra en una página', () => {
    const { container } = render(
      <Pagination slug="compresores" current={1} total={15} pageSize={20} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('la página 1 se enlaza SIN ?page=1 — una sola URL canónica', () => {
    render(<Pagination slug="compresores" current={2} total={45} pageSize={20} />);

    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '/categorias/compresores',
    );
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute(
      'href',
      '/categorias/compresores?page=2',
    );
  });

  it('marca la página actual con aria-current y emite rel prev/next en el medio', () => {
    render(<Pagination slug="compresores" current={2} total={45} pageSize={20} />);

    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Anterior' })).toHaveAttribute('rel', 'prev');
    expect(screen.getByRole('link', { name: 'Siguiente' })).toHaveAttribute('rel', 'next');
  });

  it('no ofrece "Anterior" en la primera ni "Siguiente" en la última', () => {
    const { unmount } = render(
      <Pagination slug="compresores" current={1} total={45} pageSize={20} />,
    );
    expect(screen.queryByRole('link', { name: 'Anterior' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Siguiente' })).toBeInTheDocument();
    unmount();

    render(<Pagination slug="compresores" current={3} total={45} pageSize={20} />);
    expect(screen.getByRole('link', { name: 'Anterior' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Siguiente' })).not.toBeInTheDocument();
  });
});
