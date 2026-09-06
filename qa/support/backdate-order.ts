// `@dsm/db` es CJS y `@dsm/qa` es ESM: los named exports no son analizables
// estáticamente — mismo patrón que `qa/acceptance/steps/pago-manual.steps.ts`.
import db from '@dsm/db';

const { PrismaClient } = db as unknown as { PrismaClient: new () => PrismaLike };

interface PrismaLike {
  order: {
    update(args: {
      where: { id: string };
      data: { created_at: Date };
    }): Promise<{ created_at: Date }>;
    findUniqueOrThrow(args: { where: { id: string } }): Promise<Record<string, unknown>>;
  };
  $disconnect(): Promise<void>;
}

const prisma = new PrismaClient();

/**
 * T0.2 (`qa-plan.md` §9, `design.md` §D-QA5) — excepción angosta y
 * documentada: **sólo** mueve `created_at` hacia atrás, vía Prisma directo,
 * para alcanzar la precondición de antigüedad de `ORDER_ABANDON_HOURS`
 * (AC-11) / `RECONCILE_MIN_AGE_MS` (AC-10). Nunca se usa para sembrar el
 * resto de la suite (eso sigue siendo checkout real) ni para simular el
 * efecto que el escenario debe probar — los jobs (`cleanup-abandoned`,
 * `reconcile`) corren de verdad contra esa fila backdateada.
 *
 * Mismo criterio ya aplicado y ejecutado por `SC-023-A2`
 * (`qa/acceptance/steps/pago-manual.steps.ts`, transición a "cancelled" vía
 * Prisma por falta de endpoint).
 */
export async function backdateOrder(orderId: string, horasAtras: number): Promise<void> {
  const created_at = new Date(Date.now() - horasAtras * 3_600_000);
  await prisma.order.update({ where: { id: orderId }, data: { created_at } });
}

export async function disconnectBackdate(): Promise<void> {
  await prisma.$disconnect();
}
