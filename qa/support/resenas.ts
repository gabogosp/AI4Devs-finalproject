import type { APIRequestContext } from '@playwright/test';
import { QA_API_BASE_URL } from './qa-env';

/**
 * US-025 — Helpers de las acciones bajo prueba (`qa-plan.md` §3/§7):
 * `PUT /v1/me/reviews/:slug` (upsert), `GET /v1/me/reviews/:slug`
 * (elegibilidad + reseña propia), `GET /v1/products/:slug/reviews` (pública),
 * `PATCH /v1/admin/reviews/:id` (moderación). Mismo patrón de CSRF replicado
 * que `editar-perfil.ts`/`borrar-cuenta.ts`.
 *
 * `:slug`, no UUID (fix post-mortem, 2026-09-07): la única superficie
 * pública que conoce la ficha es el slug — `StorefrontProductDto` excluye
 * `id` a propósito.
 */

const API = QA_API_BASE_URL;

async function csrf(ctx: APIRequestContext): Promise<string | undefined> {
  const estado = await ctx.storageState();
  return estado.cookies.find((c) => c.name === 'dsm_csrf')?.value;
}

export interface RespuestaReseña {
  status: number;
  body: unknown;
}

export async function dejarReseña(
  ctx: APIRequestContext,
  slug: string,
  data: { rating: number; comment?: string | null },
): Promise<RespuestaReseña> {
  const token = await csrf(ctx);
  const res = await ctx.put(`/v1/me/reviews/${slug}`, {
    data,
    headers: token ? { 'x-csrf-token': token } : {},
  });
  const body = await res.json().catch(() => undefined);
  return { status: res.status(), body };
}

export async function miReseña(ctx: APIRequestContext, slug: string): Promise<RespuestaReseña> {
  const res = await ctx.get(`/v1/me/reviews/${slug}`);
  const body = await res.json().catch(() => undefined);
  return { status: res.status(), body };
}

export async function reseñasPúblicas(slug: string): Promise<RespuestaReseña> {
  const res = await fetch(`${API}/v1/products/${slug}/reviews`);
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

export async function moderarReseña(
  adminToken: string,
  reviewId: string,
  hidden: boolean,
): Promise<RespuestaReseña> {
  const res = await fetch(`${API}/v1/admin/reviews/${reviewId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ hidden }),
  });
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}
