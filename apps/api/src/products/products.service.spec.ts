import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { ValidationError } from '../common/errors/domain-errors';

/**
 * US-003 T10.2 — derivación server-side del `slug` (AC-1): se deriva del
 * `name`, la colisión se desambigua de forma determinista, y editar el nombre
 * no rompe la URL ya indexada.
 */
describe('ProductsService — slug derivado (T10.2)', () => {
  const baseInput = {
    sku: 'SKU-001',
    name: 'Heladera Exhibidora',
    price_ars_cents: 100_000,
    category_id: '11111111-1111-1111-1111-111111111111',
  };

  function makeService(takenSlugs: string[] = []) {
    const repo = {
      findSlugsByPrefix: jest.fn().mockResolvedValue(takenSlugs),
      create: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      findById: jest.fn(),
      update: jest.fn().mockImplementation((id, data) => Promise.resolve(data)),
    } as unknown as ProductsRepository;
    return { service: new ProductsService(repo), repo };
  }

  it('deriva el slug del name: kebab, minúsculas y sin acentos', async () => {
    const { service, repo } = makeService();

    await service.create({ ...baseInput, name: 'Compresor Herméico Ñandú' });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'compresor-hermeico-nandu' }),
    );
  });

  it('nunca acepta el slug del cliente: lo ignora y lo deriva del name', async () => {
    const { service, repo } = makeService();

    await service.create({
      ...baseInput,
      // Un cliente malicioso mandando `slug` no puede fijar la URL.
      slug: 'url-elegida-por-el-cliente',
    } as never);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'heladera-exhibidora' }),
    );
  });

  it('desambigua la colisión con sufijo ordinal determinista', async () => {
    const { service, repo } = makeService(['heladera-exhibidora']);

    await service.create(baseInput);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'heladera-exhibidora-2' }),
    );
  });

  it('salta los ordinales ya tomados (siguiente libre, no un random)', async () => {
    const { service, repo } = makeService([
      'heladera-exhibidora',
      'heladera-exhibidora-2',
      'heladera-exhibidora-3',
    ]);

    await service.create(baseInput);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'heladera-exhibidora-4' }),
    );
  });

  it('es reproducible: el mismo estado produce el mismo slug', async () => {
    const a = makeService(['heladera-exhibidora']);
    const b = makeService(['heladera-exhibidora']);

    await a.service.create(baseInput);
    await b.service.create(baseInput);

    expect((a.repo.create as jest.Mock).mock.calls[0][0].slug).toBe(
      (b.repo.create as jest.Mock).mock.calls[0][0].slug,
    );
  });

  it('un prefijo compartido no cuenta como colisión del base', async () => {
    // "heladera-exhibidora-industrial" empieza igual pero NO ocupa el base.
    const { service, repo } = makeService(['heladera-exhibidora-industrial']);

    await service.create(baseInput);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'heladera-exhibidora' }),
    );
  });

  it('cae al sku cuando el name no tiene caracteres alfanuméricos', async () => {
    const { service, repo } = makeService();

    await service.create({ ...baseInput, name: '###', sku: 'SKU-042' });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'sku-042' }),
    );
  });

  it('rechaza el alta cuando ni name ni sku permiten derivar una URL', async () => {
    const { service, repo } = makeService();

    await expect(
      service.create({ ...baseInput, name: '###', sku: '///' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('editar el nombre NO recalcula el slug (la URL indexada se conserva)', async () => {
    const { service, repo } = makeService();
    (repo.findById as jest.Mock).mockResolvedValue({
      id: 'p1',
      slug: 'heladera-exhibidora',
      name: 'Heladera Exhibidora',
      status: 'published',
    });

    await service.update('p1', { name: 'Heladera Exhibidora Premium' });

    const patch = (repo.update as jest.Mock).mock.calls[0][1];
    expect(patch).not.toHaveProperty('slug');
    expect(repo.findSlugsByPrefix).not.toHaveBeenCalled();
  });
});
