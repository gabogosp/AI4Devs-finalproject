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
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
};
