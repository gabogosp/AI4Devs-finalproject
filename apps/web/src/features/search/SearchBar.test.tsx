import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const { SearchBar, INVITACION_CONSULTA_CORTA, PLACEHOLDER_BUSCADOR } = await import(
  './SearchBar'
);

afterEach(() => {
  push.mockClear();
});

/** Devuelve el input y un helper para escribir + enviar. */
async function buscar(texto: string) {
  const user = userEvent.setup();
  const input = screen.getByRole('searchbox', { name: /buscar productos/i });
  await user.clear(input);
  if (texto) await user.type(input, texto);
  await user.type(input, '{Enter}');
  return input;
}

describe('SearchBar — navegación', () => {
  it('con una consulta útil navega a /buscar con la consulta encodeada', async () => {
    render(<SearchBar />);

    await buscar('caño 1/2 + codo');

    expect(push).toHaveBeenCalledTimes(1);
    const destino = push.mock.calls[0][0] as string;
    // Lo que importa: el `+` y el `/` viajan encodeados. Interpolando a mano, el
    // `+` llegaría como espacio y la consulta se buscaría partida.
    expect(destino.startsWith('/buscar?')).toBe(true);
    const recibido = new URLSearchParams(destino.split('?')[1]).get('q');
    expect(recibido).toBe('caño 1/2 + codo');
  });

  it('normaliza los espacios antes de navegar', async () => {
    render(<SearchBar />);

    await buscar('  taco   fischer  ');

    const q = new URLSearchParams(
      (push.mock.calls[0][0] as string).split('?')[1],
    ).get('q');
    expect(q).toBe('taco fischer');
  });

  it('conserva las mayúsculas de lo que escribió el cliente', async () => {
    render(<SearchBar />);

    await buscar('Taco Fischer SX');

    const q = new URLSearchParams(
      (push.mock.calls[0][0] as string).split('?')[1],
    ).get('q');
    expect(q).toBe('Taco Fischer SX');
  });
});

describe('SearchBar — AC-5: la consulta corta no gasta una búsqueda', () => {
  it.each([['a'], ['  '], ['  a  ']])(
    'con %j no navega y explica qué falta',
    async (texto) => {
      render(<SearchBar />);

      await buscar(texto);

      // El corazón de AC-5: `push` no se llamó, así que no hubo navegación y por
      // lo tanto tampoco request al proveedor de IA.
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByText(INVITACION_CONSULTA_CORTA)).toBeInTheDocument();
    },
  );

  it('con el input vacío tampoco navega', async () => {
    render(<SearchBar />);

    await buscar('');

    expect(push).not.toHaveBeenCalled();
  });

  it('el input conserva lo escrito tras el rechazo', async () => {
    render(<SearchBar />);

    const input = await buscar('a');

    // Borrarle el texto lo obliga a empezar de cero justo cuando le estamos
    // pidiendo que agregue algo.
    expect(input).toHaveValue('a');
  });

  it('el rechazo desaparece cuando la consulta pasa a ser útil', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await buscar('a');
    expect(screen.getByText(INVITACION_CONSULTA_CORTA)).toBeInTheDocument();

    const input = screen.getByRole('searchbox', { name: /buscar productos/i });
    await user.type(input, 'rosca{Enter}');

    expect(push).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(INVITACION_CONSULTA_CORTA)).not.toBeInTheDocument();
  });
});

describe('SearchBar — accesibilidad', () => {
  it('el nombre accesible no depende del placeholder', async () => {
    render(<SearchBar />);

    // El placeholder desaparece al tipear: si fuera la única etiqueta, quien usa
    // lector de pantalla perdería el nombre del campo justo mientras lo llena.
    const input = screen.getByRole('searchbox', { name: /buscar productos/i });
    expect(input).toHaveAttribute('placeholder', PLACEHOLDER_BUSCADOR);

    await userEvent.setup().type(input, 'taco');
    expect(
      screen.getByRole('searchbox', { name: /buscar productos/i }),
    ).toBeInTheDocument();
  });

  it('es un landmark de búsqueda y el rechazo queda asociado al input', async () => {
    render(<SearchBar />);
    expect(screen.getByRole('search')).toBeInTheDocument();

    const input = await buscar('a');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    const descrito = input.getAttribute('aria-describedby');
    expect(descrito).toBeTruthy();
    expect(document.getElementById(descrito!)).toHaveTextContent(
      INVITACION_CONSULTA_CORTA,
    );
  });

  it('se opera sólo con teclado: Tab al input y Enter para buscar', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await user.tab();
    expect(screen.getByRole('searchbox', { name: /buscar productos/i })).toHaveFocus();

    await user.keyboard('taco fischer{Enter}');
    expect(push).toHaveBeenCalledTimes(1);
  });
});
