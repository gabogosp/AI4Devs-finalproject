import { z } from 'zod';

/**
 * Env público tipado + validado (next-standards §8). Solo variables con prefijo
 * `NEXT_PUBLIC_` — NUNCA secretos server-only en el bundle del cliente.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z
    .string()
    .min(1, 'NEXT_PUBLIC_API_BASE_URL es requerida')
    .default('http://localhost:3000'),
  /**
   * Origen público del sitio. Se usa para construir URLs **absolutas** en
   * canonical, Open Graph y JSON-LD — los buscadores las exigen absolutas.
   * Se inlinea en BUILD (no en runtime): si falta en el paso de build del
   * pipeline, producción publica canonicals apuntando a localhost.
   */
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .min(1, 'NEXT_PUBLIC_SITE_URL es requerida')
    .default('http://localhost:3000'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const publicEnv: PublicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});
