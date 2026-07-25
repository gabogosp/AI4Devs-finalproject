import { httpRequest } from '@/lib/http/client';
import { getAuthToken, setAuthToken } from '@/lib/http/authToken';

interface LoginResponse {
  token: string;
}

// Persistencia del token en sessionStorage (seam, ADR-0009). US-014 lo migrará a
// cookie httpOnly + refresh rotado SIN reescribir este módulo ni el cliente HTTP.
const STORAGE_KEY = 'dsm.admin.token';

// CONTRATO DE INTEGRACIÓN (gap backend conocido): el panel espera
//   POST /v1/admin/auth/login  { bootstrapToken }  ->  200 { token }
// El backend ya tiene el service (AdminAuthService.loginWithBootstrap) pero aún
// NO expone el endpoint (falta un controller). Follow-up de backend.
const LOGIN_PATH = '/v1/admin/auth/login';

function persist(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.sessionStorage.setItem(STORAGE_KEY, token);
  else window.sessionStorage.removeItem(STORAGE_KEY);
}

export const adminSession = {
  /** Option A (OQ-FE-1): login admin mínimo contra el seam del backend. */
  async login(bootstrapToken: string): Promise<void> {
    const res = await httpRequest<LoginResponse>(LOGIN_PATH, {
      method: 'POST',
      body: { bootstrapToken },
    });
    setAuthToken(res.token);
    persist(res.token);
  },

  /** Rehidrata el token persistido al arranque del cliente. */
  restore(): void {
    if (typeof window === 'undefined') return;
    const token = window.sessionStorage.getItem(STORAGE_KEY);
    if (token) setAuthToken(token);
  },

  isAuthenticated(): boolean {
    return getAuthToken() !== null;
  },

  signOut(): void {
    setAuthToken(null);
    persist(null);
  },
};
