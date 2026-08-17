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
  /**
   * Teléfono de WhatsApp del local, en formato internacional sin `+` ni
   * separadores (lo que espera `wa.me`). Dato público, no secreto.
   * El número real es OQ-FE-3, pendiente del cliente — el default es un
   * placeholder que NO debe llegar a producción.
   */
  NEXT_PUBLIC_WHATSAPP_PHONE: z
    .string()
    .regex(/^\d{8,15}$/, 'NEXT_PUBLIC_WHATSAPP_PHONE debe ser sólo dígitos')
    .default('5491100000000'),
  /** Host del CDN de imágenes (ver `images.remotePatterns` en next.config). */
  NEXT_PUBLIC_IMAGE_CDN_HOST: z.string().optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const publicEnv: PublicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_WHATSAPP_PHONE: process.env.NEXT_PUBLIC_WHATSAPP_PHONE,
  NEXT_PUBLIC_IMAGE_CDN_HOST: process.env.NEXT_PUBLIC_IMAGE_CDN_HOST,
});
