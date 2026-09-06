import type { APIRequestContext } from '@playwright/test';

/**
 * US-024 — Helper de una sola función para la acción bajo prueba (`qa-plan.md`
 * §7): `PATCH /v1/me` con el header CSRF, mismo patrón que `borrar-cuenta.ts`
 * (`csrf()` interno de `customer-auth.ts` no está exportado, se replica acá).
 */

async function csrf(ctx: APIRequestContext): Promise<string | undefined> {
  const estado = await ctx.storageState();
  return estado.cookies.find((c) => c.name === 'dsm_csrf')?.value;
}

export interface RespuestaPerfil {
  status: number;
  body: unknown;
}

export interface ActualizarPerfilBody {
  name: string;
  avatar_url: string | null;
}

/** `PATCH /v1/me` real — la acción bajo prueba de todo este plan. */
export async function actualizarPerfil(
  ctx: APIRequestContext,
  data: ActualizarPerfilBody,
): Promise<RespuestaPerfil> {
  const token = await csrf(ctx);
  const res = await ctx.patch('/v1/me', {
    data,
    headers: token ? { 'x-csrf-token': token } : {},
  });
  const body = await res.json().catch(() => undefined);
  return { status: res.status(), body };
}
