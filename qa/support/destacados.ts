import { QA_API_BASE_URL } from './qa-env';

/**
 * US-026 — Helpers de las acciones bajo prueba: `GET /v1/products/novedades`
 * y `GET /v1/products/mas-vendidos`. Ambas públicas, sin auth.
 */

export interface DestacadoItem {
  slug: string;
  name: string;
  price_ars_cents: number;
  currency: string;
  image_url: string | null;
  in_stock: boolean;
}

export interface RespuestaDestacados {
  status: number;
  headers: Record<string, string>;
  body: { data: DestacadoItem[] } | undefined;
}

async function get(path: string): Promise<RespuestaDestacados> {
  const res = await fetch(`${QA_API_BASE_URL}${path}`);
  const body = await res.json().catch(() => undefined);
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body };
}

export const novedades = (): Promise<RespuestaDestacados> => get('/v1/products/novedades');
export const masVendidos = (): Promise<RespuestaDestacados> => get('/v1/products/mas-vendidos');
