import { adminAuth } from './admin-auth';
import { nuevaCategoria, nuevoProducto } from './builders';

const API = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';

async function apiCall<T>(
  path: string,
  method: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface SeedResult {
  token: string;
  categoryId: string;
  productIds: string[];
}

/**
 * Siembra determinista vía la API real (respeta la máquina de estado y las
 * validaciones — no INSERT directo). Idempotente por prefijo de corrida.
 */
export async function seedCatalogo(productos = 2): Promise<SeedResult> {
  const token = await adminAuth();
  const category = await apiCall<{ id: string }>(
    '/v1/admin/categories',
    'POST',
    token,
    nuevaCategoria(),
  );
  const productIds: string[] = [];
  for (let i = 0; i < productos; i += 1) {
    const p = await apiCall<{ id: string }>(
      '/v1/admin/products',
      'POST',
      token,
      nuevoProducto(category.id),
    );
    productIds.push(p.id);
  }
  return { token, categoryId: category.id, productIds };
}
