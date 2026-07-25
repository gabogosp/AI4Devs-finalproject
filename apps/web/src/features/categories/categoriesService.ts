import { httpRequest } from '@/lib/http/client';
import { parseContract } from '@/lib/http/contract';
import {
  GetAdminCategoriesResponse,
  PatchAdminCategoriesIdResponse,
  PostAdminCategoriesResponse,
} from '@/api/generated/zod';
import type { Category, CreateCategory } from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO — generados desde `apps/api/docs/api/openapi.yaml`
 * (`frontend-standards.md` §3.1/§3.2). Nunca se declaran a mano.
 */
export type { Category };
export type CategoryInput = CreateCategory;

/**
 * Envuelve el cliente HTTP para `/v1/admin/categories`. NO envía `slug` (lo
 * deriva el server, AC-1).
 */
export const categoriesService = {
  async list(signal?: AbortSignal): Promise<Category[]> {
    const body = await httpRequest<unknown>('/v1/admin/categories', { signal });
    return parseContract(GetAdminCategoriesResponse, body);
  },

  async create(input: CategoryInput): Promise<Category> {
    const body = await httpRequest<unknown>('/v1/admin/categories', {
      method: 'POST',
      body: {
        name: input.name,
        ...(input.parent_id ? { parent_id: input.parent_id } : {}),
      },
    });
    return parseContract(PostAdminCategoriesResponse, body);
  },

  async update(id: string, input: CategoryInput): Promise<Category> {
    const body = await httpRequest<unknown>(`/v1/admin/categories/${id}`, {
      method: 'PATCH',
      body: {
        name: input.name,
        ...(input.parent_id ? { parent_id: input.parent_id } : {}),
      },
    });
    return parseContract(PatchAdminCategoriesIdResponse, body);
  },
};
