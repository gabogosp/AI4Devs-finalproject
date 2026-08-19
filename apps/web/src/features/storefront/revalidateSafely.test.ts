import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidateProduct = vi.fn();
const revalidateCatalog = vi.fn();
const captureError = vi.fn();

vi.mock('./revalidate', () => ({
  revalidateProduct: (slug: string) => revalidateProduct(slug),
  revalidateCatalog: () => revalidateCatalog(),
}));
vi.mock('@/lib/observability/sentry', () => ({
  captureError: (e: unknown) => captureError(e),
}));

const { revalidateCatalogSafely, revalidateProductSafely } = await import('./revalidateSafely');

/** El puente es fire-and-forget: hay que dejar drenar la microtask. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  revalidateProduct.mockReset().mockResolvedValue(undefined);
  revalidateCatalog.mockReset().mockResolvedValue(undefined);
  captureError.mockReset();
});

describe('revalidateProductSafely', () => {
  it('invalida la ficha Y el catálogo — publicar un producto cambia también la grilla (AC-8)', async () => {
    revalidateProductSafely('heladera-exhibidora');
    await flush();

    expect(revalidateProduct).toHaveBeenCalledWith('heladera-exhibidora');
    expect(revalidateCatalog).toHaveBeenCalledTimes(1);
  });

  it('no lanza ni propaga cuando una purga falla: reporta y sigue', async () => {
    revalidateCatalog.mockRejectedValue(new Error('cache down'));

    expect(() => revalidateProductSafely('heladera-exhibidora')).not.toThrow();
    await flush();

    // La mutación YA fue confirmada por el backend: fallar acá sería mentirle
    // al dueño sobre lo que pasó. Se reporta y el safety-net de 1 h cubre.
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});

describe('revalidateCatalogSafely', () => {
  it('invalida el catálogo sin tocar ninguna ficha puntual', async () => {
    revalidateCatalogSafely();
    await flush();

    expect(revalidateCatalog).toHaveBeenCalledTimes(1);
    expect(revalidateProduct).not.toHaveBeenCalled();
  });

  it('reporta el fallo en vez de romper el feedback de la mutación', async () => {
    revalidateCatalog.mockRejectedValue(new Error('cache down'));

    expect(() => revalidateCatalogSafely()).not.toThrow();
    await flush();

    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
