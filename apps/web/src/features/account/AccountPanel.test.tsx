import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { AccountPanel } from './AccountPanel';
import { SessionProvider } from './SessionProvider';
import { SESSION_HINT_KEY } from './sessionState';

const SITE = 'http://localhost:3000';
const customer = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'ana@example.com',
  name: 'Ana Gómez',
  phone: null,
  avatar_url: null,
  created_at: '2026-08-22T12:00:00Z',
};

afterEach(() => window.localStorage.clear());

describe('AccountPanel (US-015 T5.2 — cierre del placeholder)', () => {
  it('muestra un link a /mi-cuenta/compras y ya no muestra "Próximamente"', async () => {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
    server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));

    render(
      <SessionProvider>
        <AccountPanel />
      </SessionProvider>,
    );

    const link = await screen.findByRole('link', { name: /ver historial de compras/i });
    expect(link).toHaveAttribute('href', '/mi-cuenta/compras');
    await waitFor(() => expect(screen.queryByText(/próximamente/i)).not.toBeInTheDocument());
  });
});
