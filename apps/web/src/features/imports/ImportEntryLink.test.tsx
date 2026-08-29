import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImportEntryLink } from './ImportEntryLink';

describe('ImportEntryLink', () => {
  it('es un link con nombre accesible que apunta a /admin/importar', () => {
    render(<ImportEntryLink />);

    const link = screen.getByRole('link', { name: /importar catálogo/i });
    expect(link).toHaveAttribute('href', '/admin/importar');
  });

  it('es alcanzable por teclado (es un link real, no un div con onClick)', () => {
    render(<ImportEntryLink />);

    const link = screen.getByRole('link', { name: /importar catálogo/i });
    link.focus();
    expect(document.activeElement).toBe(link);
  });
});
