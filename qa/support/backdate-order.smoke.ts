// `@dsm/db` es CJS y `@dsm/qa` es ESM: los named exports no son analizables
// estáticamente — mismo patrón que `backdate-order.ts`.
import db from '@dsm/db';
import { backdateOrder, disconnectBackdate } from './backdate-order';
import { seedPendingPaymentOrder } from './seed-pending-payment-order';

const { PrismaClient } = db as unknown as { PrismaClient: new () => PrismaLike };
interface PrismaLike {
  order: { findUniqueOrThrow(args: { where: { id: string } }): Promise<Record<string, unknown>> };
  $disconnect(): Promise<void>;
}
const prisma = new PrismaClient();

const MARGEN_MS = 5_000;

async function main(): Promise<void> {
  const seed = await seedPendingPaymentOrder({ qty: 1 });
  const antes = await prisma.order.findUniqueOrThrow({ where: { id: seed.id } });

  const HORAS = 49;
  await backdateOrder(seed.id, HORAS);

  const despues = await prisma.order.findUniqueOrThrow({ where: { id: seed.id } });

  const esperado = Date.now() - HORAS * 3_600_000;
  const real = (despues.created_at as Date).getTime();
  if (Math.abs(real - esperado) > MARGEN_MS) {
    console.error(
      `FAIL: created_at fuera de margen — esperado ~${new Date(esperado).toISOString()}, ` +
        `llegó ${new Date(real).toISOString()}`,
    );
    await prisma.$disconnect();
    await disconnectBackdate();
    process.exit(1);
  }

  for (const campo of Object.keys(antes)) {
    if (campo === 'created_at' || campo === 'updated_at') continue;
    if (JSON.stringify(antes[campo]) !== JSON.stringify(despues[campo])) {
      console.error(
        `FAIL: backdateOrder tocó la columna "${campo}" (antes=${JSON.stringify(antes[campo])}, ` +
          `después=${JSON.stringify(despues[campo])})`,
      );
      await prisma.$disconnect();
      await disconnectBackdate();
      process.exit(1);
    }
  }

  await prisma.$disconnect();
  await disconnectBackdate();
  console.log(`OK: backdateOrder movió created_at ${HORAS}h atrás sin tocar otra columna`);
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
