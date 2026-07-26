import jwt from 'jsonwebtoken';

/**
 * Fixture de auth admin para la suite cross-stack (OQ-QA-1).
 *
 * REGLA (testing-standards §14.2 — "factories that hide important wiring" está
 * prohibido): el fallback existe SÓLO para entornos sin credenciales, **nunca**
 * para tapar un login real roto. Si hay `ADMIN_BOOTSTRAP_TOKEN` configurado, la
 * ruta real DEBE funcionar; si responde mal, se falla ruidoso en vez de mintear
 * un JWT y dejar que toda la suite pase verde contra una costura rota.
 *
 * Precedencia:
 *   1) `ADMIN_BOOTSTRAP_TOKEN` presente → login REAL contra
 *      `POST /v1/admin/auth/login` (backend Fase 9). Falla → THROW.
 *   2) Sin `ADMIN_BOOTSTRAP_TOKEN` → fallback test-only (JWT minteado con el
 *      `JWT_SECRET` compartido), anunciado por consola. Prohibido en modo estricto.
 *
 * Modo estricto (`QA_AUTH_STRICT=true`, automático en CI): el fallback está
 * prohibido — sin credenciales se falla en lugar de degradar en silencio.
 */
const API = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const BOOTSTRAP = process.env.ADMIN_BOOTSTRAP_TOKEN;

/** El fallback nunca es aceptable en CI. */
const STRICT =
  process.env.QA_AUTH_STRICT === 'true' ||
  (process.env.CI === 'true' && process.env.QA_AUTH_STRICT !== 'false');

export type AdminAuthSource = 'real-login' | 'minted-fallback';

export interface AdminAuthResult {
  token: string;
  /** Qué rama resolvió. La suite puede asertar `real-login`. */
  source: AdminAuthSource;
}

export function mintAdminToken(): string {
  return jwt.sign({ role: 'admin', sub: 'admin' }, JWT_SECRET, {
    expiresIn: '1h',
  });
}

/**
 * Devuelve el token admin y **de dónde salió**. Usar esta variante cuando el
 * test necesita asertar que ejercitó el login real.
 */
export async function adminAuthWithSource(): Promise<AdminAuthResult> {
  if (BOOTSTRAP) {
    // Credenciales configuradas ⇒ la ruta real es obligatoria. Sin fallback.
    let res: Response;
    try {
      res = await fetch(`${API}/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bootstrapToken: BOOTSTRAP }),
      });
    } catch (cause) {
      throw new Error(
        `[qa/admin-auth] ADMIN_BOOTSTRAP_TOKEN está configurado pero la API no responde en ${API}. ` +
          `NO se mintea un token de reemplazo: eso enmascararía una costura de login rota. ` +
          `Levantá la API o desconfigurá ADMIN_BOOTSTRAP_TOKEN para usar el fallback explícito.`,
        { cause },
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `[qa/admin-auth] El login real falló: POST ${API}/v1/admin/auth/login → ${res.status}. ` +
          `NO se mintea un token de reemplazo (testing-standards §14.2). Respuesta: ${body.slice(0, 200)}`,
      );
    }

    const parsed = (await res.json()) as { token?: unknown };
    if (typeof parsed.token !== 'string' || parsed.token.length === 0) {
      throw new Error(
        `[qa/admin-auth] El login real respondió 200 pero sin \`token\` string — el contrato ` +
          `(openapi.yaml, AdminLoginResponse) no se cumple.`,
      );
    }
    return { token: parsed.token, source: 'real-login' };
  }

  if (STRICT) {
    throw new Error(
      `[qa/admin-auth] Modo estricto: falta ADMIN_BOOTSTRAP_TOKEN y el fallback de JWT minteado ` +
        `está prohibido (la suite debe ejercitar el login real). Configurá ADMIN_BOOTSTRAP_TOKEN, ` +
        `o QA_AUTH_STRICT=false si de verdad querés el fallback.`,
    );
  }

  console.warn(
    `[qa/admin-auth] FALLBACK: sin ADMIN_BOOTSTRAP_TOKEN → se mintea un JWT role=admin. ` +
      `La costura de login real NO se está ejercitando.`,
  );
  return { token: mintAdminToken(), source: 'minted-fallback' };
}

/** Azúcar para los consumidores que sólo necesitan el token. */
export async function adminAuth(): Promise<string> {
  return (await adminAuthWithSource()).token;
}
