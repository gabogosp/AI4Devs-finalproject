import { parseContract } from '@/lib/http/contract';
import {
  getAdminCategories,
  patchAdminCategoriesId,
  postAdminCategories,
} from '@/api/generated/endpoints';
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

/** Sólo envía lo que el contrato declara; el `slug` lo deriva el server (AC-1). */
function payload(input: CategoryInput): CreateCategory {
  return {
    name: input.name,
    ...(input.parent_id ? { parent_id: input.parent_id } : {}),
  };
}

/**
 * Lógica de servicio de categorías (`frontend-standards` §3.3). La red va por
 * las **operaciones generadas** (F48); la respuesta se valida en el borde con
 * los schemas Zod generados.
 */
export const categoriesService = {
  async list(signal?: AbortSignal): Promise<Category[]> {
    const res = await getAdminCategories({ signal });
    return parseContract(GetAdminCategoriesResponse, res.data);
  },

  async create(input: CategoryInput): Promise<Category> {
    const res = await postAdminCategories(payload(input));
    return parseContract(PostAdminCategoriesResponse, res.data);
  },

  async update(id: string, input: CategoryInput): Promise<Category> {
    const res = await patchAdminCategoriesId(id, payload(input));
    return parseContract(PatchAdminCategoriesIdResponse, res.data);
  },
};
