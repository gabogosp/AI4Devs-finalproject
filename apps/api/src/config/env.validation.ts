import { z } from 'zod';

/**
 * Esquema de env validado al arranque (backend-node-standards §7 — fail-fast).
 * Si falta o es inválida una variable requerida, el arranque lanza y la app
 * NO levanta con configuración a medias.
 */
export const envSchema = z.object({
  /**
   * Entorno de ejecución. No estaba declarado hasta T7.2, y hacía falta: sin él
   * el refinement de producción de abajo no tendría contra qué comparar y sería
   * letra muerta. `development` por defecto — el default seguro es el que NO
   * activa las exigencias de producción por accidente en local.
   */
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
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

  // §7.3 + ADR-0011 — superficie de auth de clientes (US-014). Defaults seguros;
  // un valor inválido hace FALLAR el arranque, nunca cae al default en silencio.
  AUTH_ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),
  AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  AUTH_LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_BASE_MIN: z.coerce.number().int().positive().default(15),
  AUTH_LOCKOUT_MAX_MIN: z.coerce.number().int().positive().default(60),
  PASSWORD_RESET_TTL_MIN: z.coerce.number().int().positive().default(60),
  PASSWORD_RESET_MAX_PER_HOUR: z.coerce.number().int().positive().default(3),
  BCRYPT_COST: z.coerce.number().int().positive().default(12),

  // T7.2 — entrega real del email de recuperación (decisión del PO, 2026-08-19).
  // Opcionales a nivel de campo, pero NO en producción: el refinement de abajo
  // hace fallar el arranque si faltan con `NODE_ENV=production`.
  RESEND_API_KEY: z.string().min(1).optional(),
  PASSWORD_RESET_FROM: z.string().email().optional(),
  /** Base del enlace del email — el reset se completa en el frontend. */
  PASSWORD_RESET_URL_BASE: z.string().url().optional(),
}).superRefine((env, ctx) => {
  // Sin esto, un deploy mal configurado caería al adapter de log y el flujo de
  // recuperación "funcionaría" sin enviar un solo email. Nadie se entera hasta
  // que un cliente no puede recuperar su cuenta — peor que no arrancar.
  if (env.NODE_ENV !== 'production') return;

  for (const campo of [
    'RESEND_API_KEY',
    'PASSWORD_RESET_FROM',
    'PASSWORD_RESET_URL_BASE',
  ] as const) {
    if (!env[campo]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [campo],
        message:
          'requerida en producción: sin ella el reset caería al adapter de log y no se enviaría ningún email',
      });
    }
  }
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
