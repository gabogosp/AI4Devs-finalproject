import { httpRequest } from '@/lib/http/client';
import { parseContract } from '@/lib/http/contract';
import {
  GetAdminProductsIdResponse,
  GetAdminProductsResponse,
  PatchAdminProductsIdResponse,
  PostAdminProductsResponse,
} from '@/api/generated/zod';
import type {
  CreateProduct,
  Product,
  ProductList,
  ProductStatus,
  UpdateProduct,
} from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO — generados desde `apps/api/docs/api/openapi.yaml`
 * (`frontend-standards.md` §3.1/§3.2). Se re-exportan con los nombres de dominio
 * que usa el panel; nunca se declaran a mano.
 */
export type { Product, ProductStatus };
export type ProductPage = ProductList;
export type CreateProductInput = CreateProduct;
export type UpdateProductInput = UpdateProduct;

/** Envuelve el cliente HTTP para `/v1/admin/products`. Money en centavos (§8 E2E). */
export const productsService = {
  async list(
    params: { limit: number; offset: number },
    signal?: AbortSignal,
  ): Promise<ProductPage> {
    const qs = `?limit=${params.limit}&offset=${params.offset}`;
    const body = await httpRequest<unknown>(`/v1/admin/products${qs}`, {
      signal,
    });
    return parseContract(GetAdminProductsResponse, body);
  },

  async get(id: string, signal?: AbortSignal): Promise<Product> {
    const body = await httpRequest<unknown>(`/v1/admin/products/${id}`, {
      signal,
    });
    return parseContract(GetAdminProductsIdResponse, body);
  },

  async create(input: CreateProductInput): Promise<Product> {
    const body = await httpRequest<unknown>('/v1/admin/products', {
      method: 'POST',
      body: input,
    });
    return parseContract(PostAdminProductsResponse, body);
  },

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    const body = await httpRequest<unknown>(`/v1/admin/products/${id}`, {
      method: 'PATCH',
      body: input,
    });
    return parseContract(PatchAdminProductsIdResponse, body);
  },

  publish(id: string): Promise<Product> {
    return productsService.update(id, { status: 'published' });
  },

  archive(id: string): Promise<Product> {
    return productsService.update(id, { status: 'archived' });
  },
};
