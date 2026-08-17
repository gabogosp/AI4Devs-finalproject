import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({
  revalidateTag: (tag: string) => revalidateTag(tag),
  revalidatePath: (path: string) => revalidatePath(path),
}));

const { revalidateProduct } = await import('./revalidate');

describe('revalidateProduct', () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    revalidatePath.mockClear();
  });

  it('invalida el tag del producto y la ruta de su ficha', async () => {
    await revalidateProduct('heladera-exhibidora');

    expect(revalidateTag).toHaveBeenCalledWith('product:heladera-exhibidora');
    expect(revalidatePath).toHaveBeenCalledWith('/productos/heladera-exhibidora');
  });

  it('invalida la ruta además del tag — es lo que cubre el 404 cacheado que luego se publica', async () => {
    await revalidateProduct('taladro-percutor');

    // Si sólo se invalidara el tag, publicar un producto cuya ficha quedó
    // cacheada como 404 seguiría sirviendo el 404 hasta que expire.
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it.each(['Heladera', 'con espacio', 'trailing-', 'UPPER-case', '', 'a--b'])(
    'rechaza un slug inválido (%j) sin invalidar nada',
    async (invalid) => {
      await expect(revalidateProduct(invalid)).rejects.toThrow();

      expect(revalidateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});
