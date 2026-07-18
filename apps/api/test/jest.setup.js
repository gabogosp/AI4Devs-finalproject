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
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
