import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CategoryJsonLd } from './CategoryJsonLd';
import type { StorefrontCategory } from './categoriesStorefrontService';

const category = (over: Partial<StorefrontCategory> = {}): StorefrontCategory =>
  ({ slug: 'climatizacion', name: 'Climatización', parent: null, children: [], ...over }) as StorefrontCategory;

describe('CategoryJsonLd (AC-4)', () => {
  it('emite exactamente UN script ld+json con @type BreadcrumbList', () => {
    const { container } = render(<CategoryJsonLd category={category()} />);

    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(1);

    const parsed = JSON.parse(scripts[0].innerHTML);
    expect(parsed['@type']).toBe('BreadcrumbList');
    expect(parsed.itemListElement).toHaveLength(2);
  });

  it('un nombre con </script> no rompe el documento', () => {
    const { container } = render(
      <CategoryJsonLd category={category({ name: 'Aire</script><script>alert(1)</script>' })} />,
    );

    const html = container.querySelector('script[type="application/ld+json"]')!.innerHTML;
    expect(html).not.toContain('</script>');
    expect(() => JSON.parse(html)).not.toThrow();
  });
});
