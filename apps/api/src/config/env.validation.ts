import { z } from 'zod';

/**
 * Esquema de env validado al arranque (backend-node-standards §7 — fail-fast).
 * Si falta o es inválida una variable requerida, el arranque lanza y la app
 * NO levanta con configuración a medias.
 */
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'requerida'),
  JWT_SECRET: z.string().min(1, 'requerida'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Seam de auth admin (ADR-0009): emisión interina detrás de config.
  ADMIN_AUTH_ENABLED: z
    .enum(['true', 'false'])
    .default('true'),
  ADMIN_BOOTSTRAP_TOKEN: z.string().optional(),

  // §7.2 CORS — allowlist EXPLÍCITA por entorno. Orígenes completos
  // (scheme+host+port) separados por coma; se comparan por igualdad exacta.
  // Nunca `*` (el panel manda credenciales) ni regex/sufijo.
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // §7.3 Rate limiting de la superficie de auth (por IP).
  AUTH_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(900_000), // 15 min
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),

  // §7.3 Rate limiting de la superficie pública del storefront (por IP). Más
  // laxa que auth: es lectura anónima, no un vector de brute-force.
  STOREFRONT_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000), // 1 min
  STOREFRONT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
});

/** Parsea la allowlist de CORS a orígenes exactos, sin vacíos. */
export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Config de entorno inválida (fail-fast §7): ${issues}`);
  }
  return parsed.data;
}
