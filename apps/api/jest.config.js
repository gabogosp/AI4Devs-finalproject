/** Unit + integration tests (colocados en src/, sufijo .spec.ts). */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@dsm/db$': '<rootDir>/../../packages/db/index.ts',
  },
  setupFiles: ['<rootDir>/test/jest.setup.js'],
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
  testTimeout: 30000,
  // Integration/e2e comparten un único Postgres (docker-compose) y hacen TRUNCATE;
  // serializamos para evitar carreras entre archivos de test.
  maxWorkers: 1,
};
