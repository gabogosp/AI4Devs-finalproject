## Why

Seis findings del backend audit (`dsm-api/2026-08-22/audit.md`) identifican deuda técnica en `apps/api`. El Major (dsm-api-001): `CartService` recibe `Request`/`Response` de Express directamente, violando la separación de capas. Los 3 Minor: falta OpenAPI contract validation (dsm-api-005), no hay tests de integración reproducibles con Testcontainers (dsm-api-007), y falta documentación per-service (dsm-api-011). Los 2 Info: `EnrichmentQueue` es un stub por diseño (dsm-api-012) y los tests de integración usan DB local aceptablemente (dsm-api-013).

## What changes

1. **Extraer la interacción con cookies/HTTP del CartService** — mover la resolución de sesión/cookie a un interceptor o al controller, pasando al service un valor de dominio (`CartSession`). El service no debe importar `Request`/`Response` de Express. (dsm-api-001)
2. **Agregar OpenAPI contract validation en CI** — step `spectral lint` + al menos un test supertest que valide response shape para endpoints implementados. (dsm-api-005)
3. **Documentar/configurar Testcontainers o docker-compose en CI** — garantizar que los tests de integración son reproducibles en un runner limpio. (dsm-api-007)
4. **Crear doc per-service mínimo** — runbook + SLO + data-model link en `docs/services/dsm-ecommerce/`. (dsm-api-011)
5. **Cerrar Info: documentar que el stub de EnrichmentQueue es by-design** — agregar comentario en el código o en el README que referencie ADR-0014. (dsm-api-012)
6. **Cerrar Info: confirmar que docker-compose en CI es aceptable** — documentar en el README de la API o en testing-strategy que los tests de integración dependen de `docker compose up -d` y que CI lo levanta. (dsm-api-013)

## Out of scope

- dsm-api-002 (graceful shutdown): ya `addressed`.
- dsm-api-003 (Resend timeout): ya `addressed`.
- dsm-api-004 (assertions débiles): `accepted-as-debt`.
- dsm-api-006 (métricas Prometheus): ya `addressed`.
- dsm-api-008 (`$queryRawUnsafe`): `false-positive`.
- dsm-api-009 (service/version en logs): ya `addressed`.
- dsm-api-010 (Node engine): `false-positive`.
- No se escribe `design.md`: la extracción del CartService es un refactor con patrón conocido (interceptor + inyección de valor de dominio).

## References

- Reporte fuente: `docs/audits/dsm-api/2026-08-22/audit.md`
- Standards: `backend-node-standards.md` §2, §10; `api-standards.md` §1.1
- Código afectado: `apps/api/src/cart/cart.service.ts`, `apps/api/src/cart/cart-token.service.ts`
