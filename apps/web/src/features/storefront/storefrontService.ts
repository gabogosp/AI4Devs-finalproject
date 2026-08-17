import { parseContract } from '@/lib/http/contract';
import { storefrontGetProduct } from '@/api/generated/endpoints';
import { StorefrontGetProductResponse } from '@/api/generated/zod';
import type { StorefrontProduct } from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO (`frontend-standards` §3.1/§3.2). Nunca a mano.
 */
export type { StorefrontProduct };

/**
 * Naming del tag de caché por producto — **única fuente**. La Server Action de
 * invalidación importa este helper para no duplicar el string (design.md D2).
 * La identidad pública del producto es el `slug` (design.md D1).
 */
export const productTag = (slug: string): string => `product:${slug}`;

/**
 * Lógica de servicio del storefront (`frontend-standards` §3.3 — lo único
 * hand-written). La red va por la operación **generada** (F48) y la respuesta se
 * valida en el borde con el schema Zod generado.
 *
 * La política de caché se declara **acá**, no en el mutator: fetch etiquetado
 * con `product:{slug}` para que la mutación del panel lo invalide puntualmente
 * (next-standards §3 — caché explícita, tag lo que pensás revalidar).
 */
export const storefrontService = {
  async getProductBySlug(slug: string): Promise<StorefrontProduct> {
    const res = await storefrontGetProduct(slug, {
      // Safety-net: aunque falle la invalidación on-demand, ninguna ficha sirve
      // un precio más viejo que 1h (AC-9 — nunca indefinido). La frescura
      // inmediata la da `revalidateProduct` (design.md D2).
      next: { revalidate: 3600, tags: [productTag(slug)] },
    });
    return parseContract(StorefrontGetProductResponse, res.data);
  },
};

export const getProductBySlug = storefrontService.getProductBySlug;
