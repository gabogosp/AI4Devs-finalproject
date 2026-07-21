import { httpRequest } from '@/lib/http/client';

export type ProductStatus = 'draft' | 'published' | 'archived';

export interface Product {
  id: string;
  sku: string;
  name: string;
  description_raw: string | null;
  price_ars_cents: number;
  stock: number;
  status: ProductStatus;
  category_id: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductPage {
  data: Product[];
  pagination: { limit: number; offset: number; total: number };
}

export interface CreateProductInput {
  sku: string;
  name: string;
  price_ars_cents: number;
  stock?: number;
  category_id: string;
  description_raw?: string;
  image_url?: string;
}

export type UpdateProductInput = Partial<
  Omit<CreateProductInput, 'sku'>
>;

/** Envuelve el cliente HTTP para `/v1/admin/products`. Money en centavos (§8 E2E). */
export const productsService = {
  list(
    params: { limit: number; offset: number },
    signal?: AbortSignal,
  ): Promise<ProductPage> {
    const qs = `?limit=${params.limit}&offset=${params.offset}`;
    return httpRequest<ProductPage>(`/v1/admin/products${qs}`, { signal });
  },

  get(id: string, signal?: AbortSignal): Promise<Product> {
    return httpRequest<Product>(`/v1/admin/products/${id}`, { signal });
  },

  create(input: CreateProductInput): Promise<Product> {
    return httpRequest<Product>('/v1/admin/products', {
      method: 'POST',
      body: input,
    });
  },

  update(id: string, input: UpdateProductInput): Promise<Product> {
    return httpRequest<Product>(`/v1/admin/products/${id}`, {
      method: 'PATCH',
      body: input,
    });
  },

  publish(id: string): Promise<Product> {
    return httpRequest<Product>(`/v1/admin/products/${id}`, {
      method: 'PATCH',
      body: { status: 'published' },
    });
  },

  archive(id: string): Promise<Product> {
    return httpRequest<Product>(`/v1/admin/products/${id}`, {
      method: 'PATCH',
      body: { status: 'archived' },
    });
  },
};
