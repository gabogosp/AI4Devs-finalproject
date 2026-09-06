import type { APIRequestContext } from '@playwright/test';

/**
 * US-020 — Helper de una sola función para la acción bajo prueba
 * (`qa-plan.md` §7): `DELETE /v1/me` con el header CSRF, mismo patrón que el
 * `csrf()` interno de `qa/support/customer-auth.ts` (no exportado ahí, así
 * que se replica acá en vez de tocar ese archivo — "sin modificar").
 */

async function csrf(ctx: APIRequestContext): Promise<string | undefined> {
  const estado = await ctx.storageState();
  return estado.cookies.find((c) => c.name === 'dsm_csrf')?.value;
}

export interface RespuestaBorrado {
  status: number;
  body: unknown;
  /** Cabeceras crudas (permite duplicados de `set-cookie`, a diferencia de `res.headers()`). */
  headers: Array<{ name: string; value: string }>;
}

/** `DELETE /v1/me` real — la acción bajo prueba de todo este plan. */
export async function borrarCuenta(ctx: APIRequestContext): Promise<RespuestaBorrado> {
  const token = await csrf(ctx);
  const res = await ctx.delete('/v1/me', {
    headers: token ? { 'x-csrf-token': token } : {},
  });
  const body = await res.json().catch(() => undefined);
  return { status: res.status(), body, headers: res.headersArray() };
}

/** `true` si alguna cookie del array cruda borra `name` (Max-Age=0 o Expires en el pasado). */
export function cookieBorrada(headers: Array<{ name: string; value: string }>, cookieName: string): boolean {
  return headers.some(
    (h) =>
      h.name.toLowerCase() === 'set-cookie' &&
      h.value.startsWith(`${cookieName}=`) &&
      (/Max-Age=0/.test(h.value) || /Expires=Thu, 01 Jan 1970/.test(h.value)),
  );
}
