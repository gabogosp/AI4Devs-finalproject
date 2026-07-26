export default {
  paths: ['acceptance/features/**/*.feature'],
  import: ['acceptance/steps/**/*.ts'],
  loader: ['tsx/esm'],
  format: ['progress'],
  strict: true,
  tags: 'not @deferred',
};
