// Defaults de entorno para tests de integración/e2e-nest. Apuntan al Postgres
// pgvector ya provisionado por docker-compose (misma imagen que producción local).
// NOTA (deviación consciente vs el wording "Testcontainers" de los Exit criteria):
// se reutiliza el Postgres de docker-compose (55432) en lugar de arrancar un
// contenedor efímero por suite — mismo motor + esquema @dsm/db, más rápido y
// determinista en esta máquina. La naturaleza integration (Postgres real) se
// mantiene.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://dsm:dsm@localhost:55432/dsm?schema=public';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ADMIN_AUTH_ENABLED = process.env.ADMIN_AUTH_ENABLED || 'true';
process.env.ADMIN_BOOTSTRAP_TOKEN =
  process.env.ADMIN_BOOTSTRAP_TOKEN || 'seed-token';
// §7.2 — allowlist de CORS para los tests del borde.
process.env.CORS_ALLOWED_ORIGINS =
  process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3200';
// §7.3 — límite alto por default para que el throttle no interfiera con las
// suites de dominio; el spec de seguridad lo baja explícitamente antes de bootear.
process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX || '1000';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
