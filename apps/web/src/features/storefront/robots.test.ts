import { describe, expect, it } from 'vitest';
import robots from '@/../app/robots';

describe('robots.txt (AC-4)', () => {
  it('bloquea el panel y permite el resto', () => {
    const rules = robots().rules as { allow?: string; disallow?: string };

    expect(rules.disallow).toContain('/admin/');
    expect(rules.allow).toBe('/');
  });

  it('apunta al sitemap con URL ABSOLUTA', () => {
    // Un sitemap relativo en robots.txt es inválido: los crawlers lo ignoran.
    expect(robots().sitemap).toMatch(/^https?:\/\/.+\/sitemap\.xml$/);
  });

  it('no bloquea ninguna ruta pública', () => {
    const rules = robots().rules as { disallow?: string };

    for (const publica of ['/categorias', '/productos', '/sitemap.xml']) {
      expect(rules.disallow).not.toContain(publica);
    }
  });
});
