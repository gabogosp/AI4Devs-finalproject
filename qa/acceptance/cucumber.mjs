// tsx se registra vía NODE_OPTIONS='--import tsx' (el flag --loader está deprecado
// en Node ≥20/23). Ver scripts test:acceptance y los Verify de la tasks.md.
export default {
  paths: ['acceptance/features/**/*.feature'],
  import: ['acceptance/steps/**/*.ts'],
  format: ['progress'],
  strict: true,
  // `@frontend` (hoy sólo SC-008-X3): escenarios cross-feature que requieren
  // renderizado real de UI — no tienen (ni deben tener) step defs acá, viven en
  // Playwright (`qa/e2e/*.spec.ts`, Layer 3). Sin esta exclusión, cucumber los
  // levanta igual y falla con "undefined step" — visto real al restaurar el
  // gate CI (`qa.yml`), que corre esta suite sin filtrar `@frontend`.
  tags: 'not @deferred and not @frontend',
};
