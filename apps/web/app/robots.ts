import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';

/**
 * `robots.txt` del sitio (AC-4, ADR-0010).
 *
 * El `Disallow: /admin/` es **defensa en profundidad de indexación, no control
 * de acceso**: un crawler honesto no entra, pero cualquiera puede pedir la URL.
 * La autoridad real sigue siendo el `AdminGuard` en el cliente y el backend en
 * el servidor — mismo encuadre que el `X-Robots-Tag` que puso US-003.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/admin/' },
    sitemap: `${publicEnv.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
