import type { MetadataRoute } from 'next';
import { buildSitemap } from '@/features/storefront/sitemap';

/** Convención de archivo de metadata de Next; la lógica vive en `src/`. */
export default function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap();
}
