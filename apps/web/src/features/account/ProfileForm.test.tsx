import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { ProfileForm } from './ProfileForm';
import { SessionProvider } from './SessionProvider';
import { SESSION_HINT_KEY } from './sessionState';

const SITE = 'http://localhost:3000';

const customer = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'ana@example.com',
  name: 'Ana Gómez',
  phone: null,
  avatar_url: null as string | null,
  created_at: '2026-08-22T12:00:00Z',
};

async function montar() {
  window.localStorage.setItem(SESSION_HINT_KEY, '1');
  server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

  render(
    <SessionProvider>
      <ProfileForm customer={customer} />
    </SessionProvider>,
  );

  await screen.findByLabelText(/nombre/i);
  return userEvent.setup();
}

const guardar = () => screen.getByRole('button', { name: /^guardar$/i });

describe('ProfileForm (US-024)', () => {
  it('AC-1: nombre nuevo se guarda y confirma con éxito', async () => {
    const user = await montar();
    server.use(
      http.patch(`${SITE}/v1/me`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({ name: 'Ana María Pérez', avatar_url: null });
        return HttpResponse.json({ ...customer, name: 'Ana María Pérez' });
      }),
    );

    await user.clear(screen.getByLabelText(/nombre/i));
    await user.type(screen.getByLabelText(/nombre/i), 'Ana María Pérez');
    await user.click(guardar());

    expect(await screen.findByRole('status')).toHaveTextContent(/perfil actualizado/i);
  });

  it('AC-2: URL https válida sobre cliente sin avatar reemplaza el placeholder', async () => {
    const user = await montar();
    server.use(
      http.patch(`${SITE}/v1/me`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.avatar_url).toBe('https://cdn.example.com/ana.jpg');
        return HttpResponse.json({ ...customer, avatar_url: 'https://cdn.example.com/ana.jpg' });
      }),
    );

    await user.type(screen.getByLabelText(/avatar/i), 'https://cdn.example.com/ana.jpg');
    await user.click(guardar());

    expect(await screen.findByRole('status')).toHaveTextContent(/perfil actualizado/i);
  });

  it('AC-3: borrar la URL manda avatar_url: null (no cadena vacía)', async () => {
    const user = await montar();
    server.use(
      http.patch(`${SITE}/v1/me`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({ name: 'Ana Gómez', avatar_url: null });
        return HttpResponse.json(customer);
      }),
    );

    // Sin escribir nada en avatar_url (queda como llegó: vacío).
    await user.click(guardar());

    expect(await screen.findByRole('status')).toHaveTextContent(/perfil actualizado/i);
  });

  it('AC-4: nombre vacío o sólo espacios se rechaza SIN request', async () => {
    let llamado = false;
    const user = await montar();
    server.use(
      http.patch(`${SITE}/v1/me`, () => {
        llamado = true;
        return HttpResponse.json(customer);
      }),
    );

    await user.clear(screen.getByLabelText(/nombre/i));
    await user.type(screen.getByLabelText(/nombre/i), '   ');
    await user.click(guardar());

    expect(await screen.findByText(/el nombre es requerido/i)).toBeInTheDocument();
    expect(llamado).toBe(false);
  });

  it('AC-5: una cadena que no es URL se rechaza SIN request', async () => {
    let llamado = false;
    const user = await montar();
    server.use(
      http.patch(`${SITE}/v1/me`, () => {
        llamado = true;
        return HttpResponse.json(customer);
      }),
    );

    await user.type(screen.getByLabelText(/avatar/i), 'no-es-url');
    await user.click(guardar());

    expect(await screen.findByText(/url inválida/i)).toBeInTheDocument();
    expect(llamado).toBe(false);
  });

  it('AC-5: un esquema distinto de http/https (ej. javascript:) se rechaza SIN request', async () => {
    let llamado = false;
    const user = await montar();
    server.use(
      http.patch(`${SITE}/v1/me`, () => {
        llamado = true;
        return HttpResponse.json(customer);
      }),
    );

    await user.type(screen.getByLabelText(/avatar/i), 'javascript:alert(1)');
    await user.click(guardar());

    expect(
      await screen.findByText(/debe empezar con http:\/\/ o https:\/\//i),
    ).toBeInTheDocument();
    expect(llamado).toBe(false);
  });

  it('AC-7: el body nunca lleva un id/customer_id — sólo name/avatar_url', async () => {
    const user = await montar();
    let capturado: Record<string, unknown> = {};
    server.use(
      http.patch(`${SITE}/v1/me`, async ({ request }) => {
        capturado = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(customer);
      }),
    );

    await user.click(guardar());
    await waitFor(() => expect(Object.keys(capturado)).not.toHaveLength(0));

    expect(Object.keys(capturado).sort()).toEqual(['avatar_url', 'name']);
  });

  it('mapea un 422 del backend al campo correspondiente', async () => {
    const user = await montar();
    server.use(
      http.patch(`${SITE}/v1/me`, () =>
        HttpResponse.json(
          {
            type: 'dsm:catalog/validation',
            title: 'Unprocessable',
            status: 422,
            errors: [{ field: 'name', message: 'Nombre inválido según el servidor' }],
          },
          { status: 422 },
        ),
      ),
    );

    await user.click(guardar());

    expect(await screen.findByText('Nombre inválido según el servidor')).toBeInTheDocument();
  });

  it('un 429 muestra el copy de rate-limit', async () => {
    const user = await montar();
    server.use(
      http.patch(`${SITE}/v1/me`, () =>
        HttpResponse.json(
          { type: 'dsm:catalog/rate-limited', title: 'Too Many Requests', status: 429 },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
      ),
    );

    await user.click(guardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(/30 segundos/i);
  });

  it('un error de red muestra el banner genérico de conexión', async () => {
    const user = await montar();
    server.use(http.patch(`${SITE}/v1/me`, () => HttpResponse.error()));

    await user.click(guardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos conectar/i);
  });
});
