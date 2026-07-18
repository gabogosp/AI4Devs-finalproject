import { setupServer } from 'msw/node';

/** Servidor MSW compartido por los tests de integración FE (mockea /v1/admin/*). */
export const server = setupServer();
