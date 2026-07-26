import jwt from 'jsonwebtoken';

/**
 * Fixture de auth admin para la suite cross-stack (OQ-QA-1). Precedencia:
 *   1) Login REAL contra `POST /v1/admin/auth/login` (backend Fase 9) con el
 *      bootstrap token — la ruta ya existe.
 *   2) Fallback test-only: mintea un JWT `role=admin` con el `JWT_SECRET`
 *      compartido (mismo contrato que `issueAdminToken`) — red para entornos sin
 *      `ADMIN_BOOTSTRAP_TOKEN` o sin la API arriba.
 */
const API = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const BOOTSTRAP = process.env.ADMIN_BOOTSTRAP_TOKEN;

export function mintAdminToken(): string {
  return jwt.sign({ role: 'admin', sub: 'admin' }, JWT_SECRET, {
    expiresIn: '1h',
  });
}

export async function adminAuth(): Promise<string> {
  if (BOOTSTRAP) {
    try {
      const res = await fetch(`${API}/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bootstrapToken: BOOTSTRAP }),
      });
      if (res.ok) {
        const body = (await res.json()) as { token: string };
        return body.token;
      }
    } catch {
      // API no disponible → fallback.
    }
  }
  return mintAdminToken();
}
