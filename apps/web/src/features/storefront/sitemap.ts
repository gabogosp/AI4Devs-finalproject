import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';
import { categoriesStorefrontService } from './categoriesStorefrontService';

/**
 * Sitemap del sitio público (AC-4).
 *
 * La lógica vive acá, en `src/`, para poder testearla; `app/sitemap.ts` sólo la
 * re-exporta (`frontend-next-standards` §6).
 *
 * **Frescura**: los fetches llevan el tag `CATALOG_TAG`, así que la misma
 * `revalidateCatalog()` que corre tras una mutación del panel refresca también
 * el sitemap.
 *
 * `Deferred: generateSitemaps particionado — disparador > 50.000 URLs`.
 */
export async function buildSitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicEnv.NEXT_PUBLIC_SITE_URL;
  const home = { url: base };

  // Un sitemap que responde 500 le enseña al crawler a no volver; uno
  // incompleto se corrige en la próxima regeneración. Se degrada, no se cae.
  const rubros = await categoriesStorefrontService.getTree().catch(() => []);
  if (rubros.length === 0) return [home];

  const categorias = rubros.flatMap((rubro) => [
    { url: `${base}/categorias/${rubro.slug}` },
    ...rubro.children.map((sub) => ({ url: `${base}/categorias/${sub.slug}` })),
  ]);

  // HOJAS a propósito: un RUBRO agrega los productos de sus subrubros (decisión
  // D1 del backend), así que recorrer rubros Y subrubros listaría cada ficha
  // dos veces. Se recorre el nivel más profundo de cada rama.
  const hojas = rubros.flatMap((rubro) =>
    rubro.children.length > 0 ? rubro.children.map((c) => c.slug) : [rubro.slug],
  );

  const porHoja = await Promise.all(
    hojas.map((slug) => categoriesStorefrontService.listAllSlugs(slug).catch(() => [])),
  );

  // Aun recorriendo hojas, un producto podría repetirse si el backend cambiara
  // la semántica de agregación: el Set lo hace idempotente.
  const productos = [...new Set(porHoja.flat())].map((slug) => ({
    url: `${base}/productos/${slug}`,
  }));

  return [home, ...categorias, ...productos];
}
