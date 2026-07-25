import type { ZodType } from 'zod';
import { AppErrorException } from './errors';

/**
 * Valida en el borde de red que la respuesta cumple el contrato OpenAPI
 * (`frontend-standards.md` §3.2 — validación runtime generada desde el spec).
 *
 * Si el backend deja de cumplir el contrato, el panel falla acá con un error
 * tipado en lugar de propagar un objeto malformado a la UI. Los schemas los
 * genera `orval` desde `apps/api/docs/api/openapi.yaml`; no se escriben a mano.
 */
export function parseContract<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppErrorException({
      kind: 'server',
      message: 'La respuesta del servidor no cumple el contrato esperado',
    });
  }
  return result.data;
}
