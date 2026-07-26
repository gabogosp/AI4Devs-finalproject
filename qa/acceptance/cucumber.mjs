// tsx se registra vía NODE_OPTIONS='--import tsx' (el flag --loader está deprecado
// en Node ≥20/23). Ver scripts test:acceptance y los Verify de la tasks.md.
export default {
  paths: ['acceptance/features/**/*.feature'],
  import: ['acceptance/steps/**/*.ts'],
  format: ['progress'],
  strict: true,
  tags: 'not @deferred',
};
