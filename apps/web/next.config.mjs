// Security headers (next-standards §8.bis). CSP arranca en report-only y se
// endurece a enforce cuando se validen las fuentes; el resto va enforce.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy-Report-Only',
    value:
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' " +
      (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000') +
      // `form-action 'self'`: aunque un XSS lograra inyectar un formulario, no
      // podría apuntar su submit a otro origen. Es la defensa que importa en
      // pantallas que reciben contraseñas (US-014 T5.2).
      "; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

/**
 * Origen del API para el rewrite de la superficie de sesión. Es **server-only**
 * a propósito (sin `NEXT_PUBLIC_`): el navegador nunca habla con el API
 * directamente para auth, así que exponerlo al bundle sería filtrar topología
 * sin ganar nada (next-standards §8).
 *
 * Falla ruidoso si falta en producción: un rewrite que apunta a `undefined`
 * devuelve 404 en el login, y ese síntoma no dice nada sobre la causa.
 */
function apiOrigin() {
  const origin = process.env.API_INTERNAL_ORIGIN;
  if (origin) return origin;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'API_INTERNAL_ORIGIN es obligatoria: sin ella el rewrite de /v1/auth/* apunta a undefined y el login devuelve 404.',
    );
  }
  return 'http://localhost:3000';
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Host de imágenes por env, nunca un comodín que acepte cualquier dominio:
    // eso convertiría al optimizador de Next en un proxy abierto que cualquiera
    // puede usar para servir imágenes de terceros a costa nuestra.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: process.env.NEXT_PUBLIC_IMAGE_CDN_HOST ?? 'localhost',
      },
    ],
  },
  /**
   * La superficie de sesión viaja por el **origen del sitio** (US-014 OQ-FE-1,
   * opción (a)). Motivo: las cookies que emite el API son host-only, y
   * `up.railway.app` está en la Public Suffix List, así que el navegador trata
   * al API y al sitio como sitios distintos — una cookie emitida por el API no
   * vuelve nunca. Con el rewrite, el navegador sólo ve su propio origen y la
   * cookie aterriza donde tiene que aterrizar.
   *
   * Es declarativo: no agrega un solo `fetch` crudo, así que F48 queda intacto.
   */
  async rewrites() {
    return [
      {
        source: '/v1/auth/:path*',
        destination: `${apiOrigin()}/v1/auth/:path*`,
      },
    ];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // El panel del dueño no se indexa (ADR-0010 + E2E §14). Defensa en
      // profundidad, NO control de acceso: la autoridad sigue siendo el
      // AdminGuard en el cliente y el backend en el servidor. Con `/admin/*`
      // como prefijo único, la regla es una sola y no hay que extenderla cada
      // vez que el panel gana una pantalla.
      {
        source: '/admin/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
