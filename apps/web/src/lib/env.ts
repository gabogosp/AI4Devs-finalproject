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
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const publicEnv: PublicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
