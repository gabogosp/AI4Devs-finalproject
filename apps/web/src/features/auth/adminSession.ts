import { getAuthToken, setAuthToken } from '@/lib/http/authToken';
import { parseContract } from '@/lib/http/contract';
import { adminLogin } from '@/api/generated/endpoints';
import { AdminLoginResponse } from '@/api/generated/zod';

// Persistencia del token en sessionStorage (seam, ADR-0009). US-014 lo migrará a
// cookie httpOnly + refresh rotado SIN reescribir este módulo ni el cliente HTTP.
const STORAGE_KEY = 'dsm.admin.token';

function persist(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.sessionStorage.setItem(STORAGE_KEY, token);
  else window.sessionStorage.removeItem(STORAGE_KEY);
}

export const adminSession = {
  /** Option A (OQ-FE-1): login admin mínimo contra el seam del backend. */
  async login(bootstrapToken: string): Promise<void> {
    const res = await adminLogin({ bootstrapToken });
    const { token } = parseContract(AdminLoginResponse, res.data);
    setAuthToken(token);
    persist(token);
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
