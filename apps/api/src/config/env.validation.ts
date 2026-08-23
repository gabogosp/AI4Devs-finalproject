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

  /**
   * Saltos de proxy confiables para resolver la IP real del cliente (§7.3).
   *
   * El rate-limit se cuenta por IP, y sin esto Express devuelve la IP del ÚLTIMO
   * salto: detrás de un CDN, todos los clientes comparten un solo cubo y el
   * límite de login se vuelve global — diez fallos de cualquiera dejarían fuera
   * a todo el mundo.
   *
   * Default **0** (no confiar en ningún proxy) porque el riesgo inverso es peor:
   * confiar de más deja que cualquiera falsifique `X-Forwarded-For` y evada el
   * límite por completo. En producción detrás de Cloudflare va `1`; en local, 0.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  // T7.2 — entrega real del email de recuperación (decisión del PO, 2026-08-19).
  // Opcionales a nivel de campo, pero NO en producción: el refinement de abajo
  // hace fallar el arranque si faltan con `NODE_ENV=production`.
  RESEND_API_KEY: z.string().min(1).optional(),
  PASSWORD_RESET_FROM: z.string().email().optional(),
  /** Base del enlace del email — el reset se completa en el frontend. */
  PASSWORD_RESET_URL_BASE: z.string().url().optional(),

  /**
   * US-007 — carrito del invitado. Defaults seguros; un valor inválido hace
   * FALLAR el arranque (§7), nunca cae al default en silencio.
   *
   * La cookie del carrito **reusa `AUTH_COOKIE_SECURE`** y NO agrega una segunda
   * variable para el mismo concepto: dos flags para "¿emito cookies Secure?" es
   * la forma de terminar con una superficie endurecida y la otra no.
   */

  /**
   * Ventana de retención del carrito invitado, deslizante desde la última
   * **escritura** (AC-4). Decisión del PO (OQ-BE-1, 2026-08-22): **7 días**, no
   * los 30 que recomendaba el diseño. La cookie (`Max-Age`) y la fila
   * (`expires_at`) se derivan de este mismo valor, así no pueden divergir.
   *
   * Costo declarado y aceptado: quien arma un carrito y vuelve a las dos semanas
   * lo encuentra vacío. Es una variable de entorno justamente para poder subirla
   * sin deploy de código si aparecen reclamos.
   */
  CART_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** Cota de líneas distintas por carrito (DoS, §7.3) → 409 al excederla. */
  CART_MAX_ITEMS: z.coerce.number().int().positive().default(50),
  /** Cota de unidades por línea (DoS, §7.3) → 422 en el DTO al excederla. */
  CART_MAX_QTY_PER_LINE: z.coerce.number().int().positive().default(99),
  /** §7.3 — presupuesto del throttler `cart` por IP: ventana y lecturas. */
  CART_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000), // 1 min
  CART_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  /**
   * Presupuesto de **escritura** (`PUT`/`DELETE`), más estricto que el de lectura:
   * es la primera superficie pública de escritura del proyecto y cada request crea
   * o modifica filas.
   */
  CART_WRITE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

  /**
   * US-006 — importación masiva de inventario. Defaults seguros; un valor
   * inválido hace FALLAR el arranque (§7), nunca cae al default en silencio:
   * un cap que se degrada a su default por un typo es un cap que no existe.
   *
   * Los tres primeros son la decisión del PO en OQ-BE-3 (2026-08-20): eligió el
   * tope AJUSTADO sobre el holgado que proponía el diseño. 5.000 filas coincide
   * con el catálogo objetivo del E2E §21, así que **no queda margen**: un
   * catálogo mayor obliga a partir el archivo. Están acá, y no hardcodeadas,
   * precisamente para poder subirlas sin deploy de código.
   */
  /** Cap de tamaño del archivo subido, aplicado ANTES de bufferizarlo (§6.4) → 413. */
  IMPORT_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(4_194_304), // 4 MiB
  /** Cap de filas de datos del archivo (el encabezado no cuenta) → 422. */
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(5_000),
  /**
   * Cap de bytes DESCOMPRIMIDOS de un xlsx (§6.6 — zip bomb / memory
   * exhaustion): el stream se aborta al superarlo, sin agotar el proceso.
   */
  IMPORT_MAX_UNCOMPRESSED_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(33_554_432), // 32 MiB
  /**
   * Filas por lote del runner. Es lo que se procesa entre dos `await`, así que
   * acota cuánto tiempo seguido ocupa el event loop y cada cuánto se publica el
   * progreso consultable (AC-7).
   */
  IMPORT_BATCH_SIZE: z.coerce.number().int().positive().default(200),
  /**
   * Tope de filas rechazadas que se persisten para el reporte. Superado, el
   * trabajo marca `report_truncated` y `failed_count` sigue contando el total
   * real — el contador no miente aunque el reporte esté recortado.
   */
  IMPORT_MAX_REPORT_ROWS: z.coerce.number().int().positive().default(1_000),
  /**
   * Antigüedad del `heartbeat_at` a partir de la cual un trabajo `running` se
   * considera muerto y el reaper lo cierra como `interrupted` (ADR-0012). Con
   * el ejecutor in-process, un reinicio del proceso deja trabajos huérfanos:
   * sin esto quedarían `running` para siempre y bloquearían el siguiente (409).
   */
  IMPORT_JOB_STALE_MS: z.coerce.number().int().positive().default(120_000), // 2 min
  /** Retención de trabajos e historial de filas rechazadas (OQ-BE-6). */
  IMPORT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  /**
   * §7.3 — presupuesto del POST de import por IP. Deliberadamente chico: cada
   * request abre un trabajo que escribe miles de filas. Los GET de estado NO
   * comparten este presupuesto (el panel hace polling del progreso).
   */
  IMPORT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  IMPORT_RATE_LIMIT_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3_600_000), // 1 h

  /**
   * US-005 — enriquecimiento IA + embeddings (ADR-0003 el proveedor, ADR-0014 el
   * ejecutor in-process). Defaults seguros; un valor inválido hace **FALLAR el
   * arranque** (§7), nunca cae al default en silencio.
   *
   * `GEMINI_API_KEY` es opcional a nivel de campo pero **requerida en producción**
   * (refinement de abajo): sin ella el runner queda `disabled` y la búsqueda semántica
   * de US-004 no tendría vectores. Es el mismo precedente de `RESEND_API_KEY` — una
   * feature que "funciona" sin hacer nada es peor que un arranque roto (D6).
   */
  GEMINI_API_KEY: z.string().min(1).optional(),
  /** Modelo del enriquecedor de texto (ADR-0003). */
  GEMINI_ENRICH_MODEL: z.string().min(1).default('gemini-1.5-flash'),
  /** Modelo de embeddings. Su dimensión (768) está fijada en el esquema. */
  GEMINI_EMBED_MODEL: z.string().min(1).default('text-embedding-004'),
  /** Timeout por llamada de enriquecimiento, en ms. */
  GEMINI_ENRICH_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  /** Timeout por llamada de embedding, en ms (la llamada es más chica que la de texto). */
  GEMINI_EMBED_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /** Tope de requests por minuto del free tier; el limitador del adapter lo respeta. */
  GEMINI_MAX_RPM: z.coerce.number().int().positive().default(15),

  /** Kill-switch del runner: en `false` el catálogo queda navegable sin enriquecer (AC-5). */
  ENRICHMENT_ENABLED: z.enum(['true', 'false']).default('true'),
  /** Productos por corrida. Tope 200: una corrida larga compite con el request path. */
  ENRICHMENT_BATCH_SIZE: z.coerce.number().int().positive().max(200).default(25),
  /** Productos en paralelo dentro de la corrida. Tope 8 por la cuota del proveedor. */
  ENRICHMENT_CONCURRENCY: z.coerce.number().int().positive().max(8).default(2),
  /** Intentos antes de abandonar un producto (AC-4/AC-5). */
  ENRICHMENT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  /** Lease del claim, en ms: una corrida que muere libera la fila al vencer (ADR-0014). */
  ENRICHMENT_LEASE_MS: z.coerce.number().int().positive().default(120_000),
  /** Enfriamiento del breaker una vez abierto, en ms. */
  ENRICHMENT_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
  /** Fallos consecutivos del proveedor que abren el breaker. */
  ENRICHMENT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  /** Tope de caracteres del texto enriquecido: control de costo y de ruido. */
  ENRICHMENT_MAX_ENRICHED_CHARS: z.coerce.number().int().positive().default(1_200),
  /** §7.3 — presupuesto de los dos endpoints admin de enriquecimiento (ventana y máximo). */
  ENRICHMENT_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  ENRICHMENT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(6),
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

  // US-005 D6 — mismo razonamiento, otra feature: sin clave el enriquecimiento
  // arranca `disabled`, así que el catálogo queda sin `description_enriched` y sin
  // embeddings. La búsqueda semántica (US-004) no tendría con qué responder y nadie
  // se enteraría hasta la demo: un arranque roto es preferible a una feature muda.
  if (!env.GEMINI_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['GEMINI_API_KEY'],
      message:
        'GEMINI_API_KEY es requerida en producción: sin ella el enriquecimiento IA queda deshabilitado, el catálogo no genera embeddings y la búsqueda semántica no tendría vectores que consultar',
    });
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
