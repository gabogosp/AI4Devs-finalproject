import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { ResetRequestForm } from './ResetRequestForm';

const SITE = 'http://localhost:3000';

afterEach(() => vi.unstubAllGlobals());

/** Devuelve el `unmount` para poder pedir dos veces sin dejar dos DOM vivos. */
async function pedir(email: string) {
  const { unmount } = render(<ResetRequestForm />);
  await userEvent.type(screen.getByLabelText(/email/i), email);
  await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
  return unmount;
}

describe('ResetRequestForm (T2.4)', () => {
  it('AC-11: la confirmación es la misma exista o no la cuenta', async () => {
    server.use(
      http.post(
        `${SITE}/v1/auth/password-reset/request`,
        () => new HttpResponse(null, { status: 202 }),
      ),
    );

    const desmontar = await pedir('existe@example.com');
    const primera = (await screen.findByRole('status')).textContent;
    desmontar();

    await pedir('no-existe@example.com');
    const segunda = (await screen.findByRole('status')).textContent;

    // El backend responde 202 en ambos casos y el frontend ni siquiera puede
    // saber cuál era cuál: la igualdad es estructural, no una coincidencia.
    expect(primera).toBe(segunda);
  });

  it('la confirmación no insinúa que la cuenta exista', async () => {
    server.use(
      http.post(
        `${SITE}/v1/auth/password-reset/request`,
        () => new HttpResponse(null, { status: 202 }),
      ),
    );

    await pedir('ana@example.com');

    const texto = (await screen.findByRole('status')).textContent ?? '';
    expect(texto).toMatch(/si el email está registrado/i);
    // Nada de "¿no te llegó? fijate si tenés cuenta": esa variante convierte
    // la pantalla en un verificador de emails.
    expect(texto).not.toMatch(/tu cuenta|no te llegó|verificá si ten/i);
  });

  it('AC-10: el 429 muestra la espera y no reintenta', async () => {
    let intentos = 0;
    server.use(
      http.post(`${SITE}/v1/auth/password-reset/request`, () => {
        intentos += 1;
        return HttpResponse.json(
          { type: 'dsm:auth/rate-limited', title: 'Too Many Requests', status: 429 },
          { status: 429, headers: { 'retry-after': '90' } },
        );
      }),
    );

    await pedir('ana@example.com');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('2 minutos'),
    );
    expect(intentos).toBe(1);
  });

  it('un email inválido se corta en el cliente sin llamar al backend', async () => {
    // Sin handler registrado: si llamara, MSW revienta por onUnhandledRequest.
    await pedir('no-es-un-email');

    expect(await screen.findByText(/email inválido/i)).toBeInTheDocument();
  });
});
