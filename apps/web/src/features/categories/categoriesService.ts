import { httpRequest } from '@/lib/http/client';

export interface Category {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface CategoryInput {
  name: string;
  parent_id?: string;
}

/**
 * Envuelve el cliente HTTP para `/v1/admin/categories`. NO envía `slug` (lo
 * deriva el server, AC-1).
 */
export const categoriesService = {
  list(signal?: AbortSignal): Promise<Category[]> {
    return httpRequest<Category[]>('/v1/admin/categories', { signal });
  },

  create(input: CategoryInput): Promise<Category> {
    return httpRequest<Category>('/v1/admin/categories', {
      method: 'POST',
      body: {
        name: input.name,
        ...(input.parent_id ? { parent_id: input.parent_id } : {}),
      },
    });
  },

  update(id: string, input: CategoryInput): Promise<Category> {
    return httpRequest<Category>(`/v1/admin/categories/${id}`, {
      method: 'PATCH',
      body: {
        name: input.name,
        ...(input.parent_id ? { parent_id: input.parent_id } : {}),
      },
    });
  },
};
