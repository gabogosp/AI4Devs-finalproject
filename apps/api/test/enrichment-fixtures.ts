import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Fixtures resistentes para las suites de integración del enriquecimiento.
 *
 * El Postgres de `docker-compose` es **compartido con las suites de otras sesiones**, y
 * varias de ellas hacen `TRUNCATE ... CASCADE`. Una categoría creada en el `beforeAll`
 * puede desaparecer a mitad de la corrida y dejar todos los `product.create` posteriores
 * fallando por FK — pasó, y el síntoma (`Invalid prisma.product.create()`) no dice nada
 * sobre la causa.
 *
 * `asegurarCategoria` es un upsert por `slug`: si la categoría sigue ahí no hace nada, y si
 * alguien la borró la vuelve a crear. Llamarla al principio de cada siembra cuesta una query
 * y elimina toda esa clase de fallo.
 */
export async function asegurarCategoria(
  prisma: PrismaService,
  slug: string,
  name: string,
): Promise<string> {
  const categoria = await prisma.category.upsert({
    where: { slug },
    update: {},
    create: { slug, name },
    select: { id: true },
  });
  return categoria.id;
}

/** Prefijo único por corrida, para no depender de `TRUNCATE` ni chocar con otras suites. */
export function idDeCorrida(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
