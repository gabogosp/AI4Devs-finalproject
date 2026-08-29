import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { accountService, type Customer } from './accountService';

/**
 * US-014 T1.1. Las rutas de auth salen **same-origin** (T0.4), así que MSW las
 * intercepta en el origen del sitio y no en el del API — si alguien quitara la
 * marca `session: 'customer'`, la llamada iría al API y estos handlers no
 * matchearían: el test falla, que es la regresión que queremos comprar.
 */
const SITE = 'http://localhost:3000';

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: '55555555-5555-4555-8555-555555555555',
  email: 'ana@example.com',
  name: 'Ana Gómez',
  phone: null,
  created_at: '2026-08-22T12:00:00Z',
  ...over,
});

describe('accountService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('register devuelve el cliente validado contra el contrato', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/register`, () =>
        HttpResponse.json({ customer: customer() }, { status: 201 }),
      ),
    );

    const c = await accountService.register({
      email: 'ana@example.com',
      password: 'Contrasena-Valida-1',
      name: 'Ana Gómez',
    });

    expect(c.email).toBe('ana@example.com');
  });

  it('login devuelve el cliente', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/login`, () =>
        HttpResponse.json({ customer: customer() }),
      ),
    );

    expect(
      (
        await accountService.login({
          email: 'ana@example.com',
          password: 'Contrasena-Valida-1',
        })
      ).name,
    ).toBe('Ana Gómez');
  });

  it('login inválido propaga el 401 como AppError unauthorized', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/login`, () =>
        HttpResponse.json(
          {
            type: 'dsm:auth/invalid-credentials',
            title: 'Unauthorized',
            status: 401,
          },
          { status: 401 },
        ),
      ),
    );

    await expect(
      accountService.login({ email: 'ana@example.com', password: 'mala' }),
    ).rejects.toMatchObject({ appError: { kind: 'unauthorized' } });
  });

  it('me devuelve quién soy según el servidor', async () => {
    server.use(
      http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer())),
    );

    expect((await accountService.me()).id).toBe(
      '55555555-5555-4555-8555-555555555555',
    );
  });

  it('logout resuelve con el 204 sin cuerpo', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    );

    // Parsear un cuerpo vacío fallaría por la forma y no por el hecho.
    await expect(accountService.logout()).resolves.toBeUndefined();
  });

  it('refresh devuelve el cliente renovado', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/refresh`, () =>
        HttpResponse.json({ customer: customer() }),
      ),
    );

    expect((await accountService.refresh()).email).toBe('ana@example.com');
  });

  it('requestReset resuelve igual para un email que no existe (AC-11)', async () => {
    server.use(
      http.post(
        `${SITE}/v1/auth/password-reset/request`,
        () => new HttpResponse(null, { status: 202 }),
      ),
    );

    // El 202 uniforme es lo que impide que el formulario sea un oráculo de qué
    // emails están registrados.
    await expect(
      accountService.requestReset({ email: 'nadie@example.com' }),
    ).resolves.toBeUndefined();
  });

  it('confirmReset con token inservible propaga el 400', async () => {
    server.use(
      http.post(`${SITE}/v1/auth/password-reset/confirm`, () =>
        HttpResponse.json(
          {
            type: 'dsm:auth/invalid-reset-token',
            title: 'Bad Request',
            status: 400,
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      accountService.confirmReset({
        token: 'vencido',
        password: 'Contrasena-Valida-1',
      }),
    ).rejects.toBeTruthy();
  });

  it('una respuesta que no cumple el contrato falla en el borde, no en la UI', async () => {
    server.use(
      http.get(`${SITE}/v1/auth/me`, () =>
        HttpResponse.json({ email: 'ana@example.com' }),
      ),
    );

    // Falta `id` y `name`: se corta acá y no dos capas más arriba con un
    // `undefined` renderizado.
    await expect(accountService.me()).rejects.toBeTruthy();
  });
});
