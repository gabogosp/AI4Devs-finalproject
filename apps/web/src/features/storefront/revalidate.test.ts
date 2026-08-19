import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({
  revalidateTag: (tag: string) => revalidateTag(tag),
  // Se reenvía el 2º argumento (`type`) SÓLO cuando viene: `revalidateCatalog`
  // distingue purgar una URL de purgar todas las instancias de un segmento
  // dinámico, y reenviar un `undefined` explícito rompería las aserciones de
  // un argumento que ya existían.
  revalidatePath: (path: string, type?: string) =>
    type === undefined ? revalidatePath(path) : revalidatePath(path, type),
}));

const { revalidateCatalog, revalidateProduct } = await import('./revalidate');
const { CATALOG_TAG } = await import('./categoriesStorefrontService');

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

describe('revalidateCatalog', () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    revalidatePath.mockClear();
  });

  it('purga la Data Cache del catálogo con el MISMO tag que usa el servicio', async () => {
    await revalidateCatalog();

    // Si el literal se duplicara y divergiera, el servicio seguiría cacheando
    // bajo un tag que nadie invalida: la grilla quedaría vieja hasta el TTL.
    expect(revalidateTag).toHaveBeenCalledWith(CATALOG_TAG);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  it('purga TODAS las instancias del segmento de categoría, no una URL suelta', async () => {
    await revalidateCatalog();

    // La forma ('/categorias/[slug]', 'page') es la que cubre el 404 cacheado
    // de una categoría recién creada: sin `type: 'page'` sólo se purgaría la
    // ruta literal "/categorias/[slug]", que no existe.
    expect(revalidatePath).toHaveBeenCalledWith('/categorias/[slug]', 'page');
  });

  it('purga también la home y el sitemap (dependen del árbol)', async () => {
    await revalidateCatalog();

    expect(revalidatePath).toHaveBeenCalledWith('/');
    expect(revalidatePath).toHaveBeenCalledWith('/sitemap.xml');
  });

  it('ejecuta exactamente las cuatro purgas — falla si alguna se quita', async () => {
    await revalidateCatalog();

    expect(revalidatePath).toHaveBeenCalledTimes(3);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });
});
