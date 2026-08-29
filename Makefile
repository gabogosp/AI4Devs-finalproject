# Targets de desarrollo local. Asumen la raíz del repo como cwd.
# Las conexiones salen de .env.local (copiá .env.example).

.PHONY: up migrate-local seed-local run-local down

up: ## Levanta las dependencias locales (Postgres + Redis) y espera healthy
	docker compose up -d

migrate-local: ## Aplica las migraciones Prisma contra el Postgres local
	pnpm --filter @dsm/db migrate

seed-local: ## Siembra datos de demo idempotentes
	pnpm --filter @dsm/db seed

run-local: ## Corre las apps del workspace en modo dev (cada app define su script dev)
	pnpm -r --parallel dev

down: ## Detiene las dependencias locales (conserva los volúmenes)
	docker compose down
