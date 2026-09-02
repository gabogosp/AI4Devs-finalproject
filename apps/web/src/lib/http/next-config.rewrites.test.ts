import { afterEach, describe, expect, it } from 'vitest';
import nextConfig from '@/../next.config.mjs';

/**
 * T0.3 — la topología de las superficies con cookies (ADR-0013).
 *
 * Este test NO prueba que la cookie viaje: eso sólo se puede demostrar contra la
 * app construida, y lo hace `e2e/cart-topology.spec.ts` (T5.1). Lo que prueba
 * acá es que las dos entradas del rewrite existen y derivan su destino de
 * `API_INTERNAL_ORIGIN`, que es la parte que se rompe en silencio: un rewrite
 * ausente no falla en local —el navegador y el API comparten `localhost`— y
 * revienta recién en producción, donde `up.railway.app` está en la Public Suffix
 * List y el sitio y el API son sitios distintos.
 */
type Rewrite = { source: string; destination: string };

const ORIGINAL = process.env.API_INTERNAL_ORIGIN;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.API_INTERNAL_ORIGIN;
  else process.env.API_INTERNAL_ORIGIN = ORIGINAL;
});

async function rewrites(): Promise<Rewrite[]> {
  const result = await nextConfig.rewrites!();
  return result as Rewrite[];
}

describe('rewrites same-origin (ADR-0013)', () => {
  it('cubre la superficie de sesión, la del carrito Y la del checkout', async () => {
    const sources = (await rewrites()).map((r) => r.source);

    expect(sources).toContain('/v1/auth/:path*');
    expect(sources).toContain('/v1/cart/:path*');
    expect(sources).toContain('/v1/checkout/:path*');
  });

  it('deriva los tres destinos de API_INTERNAL_ORIGIN', async () => {
    process.env.API_INTERNAL_ORIGIN = 'http://api-interno.test:9999';

    const rules = await rewrites();

    expect(rules.find((r) => r.source === '/v1/auth/:path*')?.destination).toBe(
      'http://api-interno.test:9999/v1/auth/:path*',
    );
    expect(rules.find((r) => r.source === '/v1/cart/:path*')?.destination).toBe(
      'http://api-interno.test:9999/v1/cart/:path*',
    );
    expect(rules.find((r) => r.source === '/v1/checkout/:path*')?.destination).toBe(
      'http://api-interno.test:9999/v1/checkout/:path*',
    );
  });

  it('preserva el `:path*` en el destino (o el sub-recurso del carrito se pierde)', async () => {
    // Sin el comodín, `PUT /v1/cart/items/{slug}` no llega: el rewrite sólo
    // resolvería `/v1/cart` y el ítem quedaría inalcanzable.
    for (const rule of await rewrites()) {
      expect(rule.destination).toMatch(/\/:path\*$/);
    }
  });

  it('NO expone el origen interno al bundle del navegador', async () => {
    // `API_INTERNAL_ORIGIN` es server-only a propósito: si alguna vez alguien la
    // renombra con el prefijo público, el navegador aprendería la topología
    // interna sin ganar nada.
    const serializado = JSON.stringify(await rewrites());

    expect(serializado).not.toContain('NEXT_PUBLIC_');
  });

  it('no agrega superficies inesperadas al rewrite', async () => {
    // El rewrite es un puente hacia el API: cada entrada nueva amplía lo que el
    // sitio proxea. Que sean exactamente tres es parte del contrato de este change.
    expect(await rewrites()).toHaveLength(3);
  });
});
