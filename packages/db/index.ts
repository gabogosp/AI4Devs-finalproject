// Barrel del paquete de esquema `@dsm/db`.
// Reexporta el PrismaClient + los tipos generados desde `prisma/schema.prisma`
// (única fuente de verdad del catálogo, US-001 bootstrap-local) para que
// `apps/api` (y el futuro worker) consuman un único client tipado sin redefinir
// el esquema. La generación del client corre con `pnpm --filter @dsm/db generate`.
export * from '@prisma/client';
export { PrismaClient, Prisma } from '@prisma/client';
