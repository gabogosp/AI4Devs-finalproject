import { afterEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { adminSession } from './adminSession';
import { getAuthToken, setAuthToken } from '@/lib/http/authToken';

const API = 'http://localhost:3000';

afterEach(() => {
  setAuthToken(null);
  window.sessionStorage.clear();
});

describe('adminSession (seam ADR-0009)', () => {
  it('login obtiene el JWT del seam, lo expone al cliente y lo persiste', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API}/v1/admin/auth/login`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ token: 'jwt-admin' });
      }),
    );

    await adminSession.login('seed-token');

    expect(body.bootstrapToken).toBe('seed-token');
    expect(getAuthToken()).toBe('jwt-admin');
    expect(adminSession.isAuthenticated()).toBe(true);
    expect(window.sessionStorage.getItem('dsm.admin.token')).toBe('jwt-admin');
  });

  it('bootstrap-token inválido → 401 y no persiste', async () => {
    server.use(
      http.post(`${API}/v1/admin/auth/login`, () =>
        HttpResponse.json({ status: 401, detail: 'inválido' }, { status: 401 }),
      ),
    );
    await expect(adminSession.login('wrong')).rejects.toMatchObject({
      appError: { kind: 'unauthorized' },
    });
    expect(adminSession.isAuthenticated()).toBe(false);
  });

  it('restore rehidrata el token persistido', () => {
    window.sessionStorage.setItem('dsm.admin.token', 'jwt-persisted');
    adminSession.restore();
    expect(getAuthToken()).toBe('jwt-persisted');
  });

  it('signOut limpia token y storage', async () => {
    setAuthToken('x');
    window.sessionStorage.setItem('dsm.admin.token', 'x');
    adminSession.signOut();
    expect(getAuthToken()).toBeNull();
    expect(window.sessionStorage.getItem('dsm.admin.token')).toBeNull();
  });
});
