import { defineConfig } from 'orval';

/**
 * Codegen del contrato FE↔BE (`frontend-standards.md` §3.1/§3.2 — obligatorio).
 *
 * El contrato canónico es el del backend hermano en el monorepo:
 * `apps/api/docs/api/openapi.yaml`. TODO artefacto derivado del contrato —
 * DTOs, validación runtime (Zod) y handlers de mock (MSW) — se **genera** desde
 * ahí; escribirlos a mano reintroduce drift silencioso (los mocks pasan verdes
 * contra el contrato viejo).
 *
 * Lo escrito a mano es SOLO la lógica de servicio/repositorio (§3.3).
 * Regenerar: `pnpm --filter @dsm/web codegen`. El gate `frontend-codegen-fresh`
 * de CI reejecuta esto y falla si produce diff.
 */
const CONTRACT = '../api/docs/api/openapi.yaml';

export default defineConfig({
  // DTOs + handlers MSW derivados del contrato.
  dsmCatalog: {
    input: { target: CONTRACT },
    output: {
      mode: 'single',
      target: './src/api/generated/endpoints.ts',
      schemas: './src/api/generated/model',
      client: 'fetch',
      baseUrl: '/v1',
      mock: { generators: [{ type: 'msw' }] },
      // F48 — las operaciones generadas delegan en nuestro mutator, así todo
      // llamado sale del cliente generado (que sólo puede nombrar endpoints del
      // contrato) sin perder los cross-cutting del panel (§8).
      override: {
        mutator: { path: './src/lib/http/client.ts', name: 'customFetch' },
      },
    },
  },

  // Validación runtime en el borde (Zod) derivada del mismo contrato.
  dsmCatalogZod: {
    input: { target: CONTRACT },
    output: {
      mode: 'single',
      target: './src/api/generated/zod.ts',
      client: 'zod',
    },
  },
});
