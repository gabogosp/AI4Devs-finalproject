import { Prisma } from '@dsm/db';

/** True si el error es un error conocido de Prisma con el código dado (P2002, P2003, P2025…). */
export function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code
  );
}

/**
 * True si el P2002 recibido apunta al campo dado. Prisma expone las columnas
 * del constraint violado en `meta.target` (array en Postgres, string en otros
 * conectores); se normalizan ambas formas.
 */
export function uniqueTargetIncludes(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.includes(field);
  }
  return typeof target === 'string' && target.includes(field);
}

export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_FK_VIOLATION = 'P2003';
export const PRISMA_RECORD_NOT_FOUND = 'P2025';
