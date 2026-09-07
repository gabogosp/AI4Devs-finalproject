import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';
import { avatarColor, initialsFrom } from '@/lib/format/avatar';

describe('Avatar', () => {
  it('sin avatarUrl, renderiza las iniciales sobre el color determinístico del id', () => {
    render(<Avatar name="Ana María Pérez" customerId="cliente-1" />);

    const placeholder = screen.getByRole('img', { name: /avatar de ana maría pérez/i });
    expect(placeholder).toHaveTextContent(initialsFrom('Ana María Pérez'));
    expect(placeholder).toHaveStyle({ backgroundColor: avatarColor('cliente-1') });
  });

  it('con avatarUrl, renderiza la imagen en vez de las iniciales', () => {
    render(
      <Avatar name="Ana" customerId="cliente-1" avatarUrl="https://cdn.example.com/ana.jpg" />,
    );

    const img = screen.getByRole('img', { name: /avatar de ana/i });
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/ana.jpg');
  });

  it('si la imagen falla al cargar (onError), degrada a iniciales sin romper el layout', () => {
    render(
      <Avatar name="Ana" customerId="cliente-1" avatarUrl="https://cdn.example.com/rota.jpg" />,
    );

    const img = screen.getByRole('img', { name: /avatar de ana/i });
    fireEvent.error(img);

    const placeholder = screen.getByRole('img', { name: /avatar de ana/i });
    expect(placeholder.tagName).not.toBe('IMG');
    expect(placeholder).toHaveTextContent(initialsFrom('Ana'));
  });

  it('sin nombre (cadena vacía) no lanza — el placeholder queda sin iniciales', () => {
    expect(() => render(<Avatar name="" customerId="cliente-1" />)).not.toThrow();
  });
});
