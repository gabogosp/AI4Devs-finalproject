import { parseContract } from '@/lib/http/contract';
import {
  listProducts,
  getProduct,
  updateProduct,
  createProduct,
} from '@/api/generated/endpoints';
import {
  GetProductResponse,
  ListProductsResponse,
  UpdateProductResponse,
  CreateProductResponse,
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

/**
 * Lógica de servicio para el catálogo (`frontend-standards` §3.3 — lo único
 * hand-written). La red va por las **operaciones generadas** (F48): el cliente
 * generado sólo puede nombrar endpoints que el contrato declara, así que una
 * ruta fuera de contrato es estructuralmente imposible. La respuesta se valida
 * en el borde con los schemas Zod generados. Money en centavos (§8 E2E).
 */
export const productsService = {
  async list(
    params: { limit: number; offset: number },
    signal?: AbortSignal,
  ): Promise<ProductPage> {
    const res = await listProducts(params, { signal });
    return parseContract(ListProductsResponse, res.data);
  },

  async get(id: string, signal?: AbortSignal): Promise<Product> {
    const res = await getProduct(id, { signal });
    return parseContract(GetProductResponse, res.data);
  },

  async create(input: CreateProductInput): Promise<Product> {
    const res = await createProduct(input);
    return parseContract(CreateProductResponse, res.data);
  },

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    const res = await updateProduct(id, input);
    return parseContract(UpdateProductResponse, res.data);
  },

  publish(id: string): Promise<Product> {
    return productsService.update(id, { status: 'published' });
  },

  archive(id: string): Promise<Product> {
    return productsService.update(id, { status: 'archived' });
  },
};
