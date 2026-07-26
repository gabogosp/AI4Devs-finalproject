// Builders de test data con defaults deterministas. El único valor no-determinista
// es el prefijo de corrida del SKU/slug (idempotencia entre runs), nunca aserido.
const RUN = process.env.QA_RUN_PREFIX ?? 'QA';

export interface CategoriaInput {
  name: string;
}
export interface ProductoInput {
  sku: string;
  name: string;
  price_ars_cents: number;
  stock: number;
  category_id: string;
  description_raw?: string;
  image_url?: string;
}

let seq = 0;
function uniq(): string {
  seq += 1;
  return `${RUN}-${seq}`;
}

export function nuevaCategoria(over: Partial<CategoriaInput> = {}): CategoriaInput {
  return { name: `Categoría ${uniq()}`, ...over };
}

export function nuevoProducto(
  category_id: string,
  over: Partial<ProductoInput> = {},
): ProductoInput {
  return {
    sku: `SKU-${uniq()}`,
    name: `Producto ${uniq()}`,
    price_ars_cents: 100000,
    stock: 5,
    category_id,
    ...over,
  };
}
