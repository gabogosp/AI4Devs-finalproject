import { Prisma } from '@dsm/db';

/** True si el error es un error conocido de Prisma con el código dado (P2002, P2003, P2025…). */
export function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code
  );
}

export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_FK_VIOLATION = 'P2003';
export const PRISMA_RECORD_NOT_FOUND = 'P2025';
