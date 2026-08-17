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
      "; frame-ancestors 'none'; base-uri 'self'",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
