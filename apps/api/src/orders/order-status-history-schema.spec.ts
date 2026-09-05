import { PrismaClient } from '@dsm/db';

/**
 * T1.1 — reconciliación F40: el esquema materializado de `order_status_history`
 * debe tener exactamente las 6 columnas que declara `design.md` §D2, la FK
 * `ON DELETE CASCADE` a `orders` y el índice compuesto `(order_id, changed_at)`.
 * Espejo de `order-schema.spec.ts` (checkout), acotado a la tabla nueva.
 */
const prisma = new PrismaClient();

const COLUMNAS_ESPERADAS = [
  'id',
  'order_id',
  'from_status',
  'to_status',
  'changed_by',
  'changed_at',
];

function ordenBase(sufijo: string) {
  return {
    access_token_hash: `h-osh-${sufijo}`,
    buyer_name: 'Comprador de Prueba',
    buyer_email: `comprador-osh-${sufijo}@test.local`,
    buyer_phone: '+54 351 555 0000',
    total_ars_cents: 100_000,
    consent_accepted: true,
    consent_accepted_at: new Date(),
    consent_terms_version: '2026-06-15',
  };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Esquema de order_status_history materializado (F40 — reconciliación con design.md §D2)', () => {
  it('tiene exactamente las 6 columnas declaradas', async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'order_status_history'`,
    );
    const real = filas.map((f) => f.column_name).sort();
    expect(real).toEqual([...COLUMNAS_ESPERADAS].sort());
  });

  it('tiene el índice compuesto (order_id, changed_at)', async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'order_status_history'`,
    );
    expect(filas.map((f) => f.indexname)).toContain(
      'order_status_history_order_id_changed_at_idx',
    );
  });

  it('INSERT con from_status=NULL y changed_by=NULL pasa (primera transición, admin bootstrap)', async () => {
    const sufijo = `null-${Date.now()}`;
    const orden = await prisma.order.create({ data: ordenBase(sufijo) });

    const fila = await prisma.orderStatusHistory.create({
      data: { order_id: orden.id, from_status: null, to_status: 'new', changed_by: null },
    });

    expect(fila.from_status).toBeNull();
    expect(fila.changed_by).toBeNull();
    expect(fila.to_status).toBe('new');
  });

  it('INSERT sin order_id falla (NOT NULL + FK)', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO order_status_history (id, from_status, to_status)
         VALUES (gen_random_uuid(), NULL, 'new')`,
      ),
    ).rejects.toThrow();
  });

  it('FK order_id CASCADE: borrar la orden se lleva sus filas de historial', async () => {
    const sufijo = `casc-${Date.now()}`;
    const orden = await prisma.order.create({ data: ordenBase(sufijo) });
    await prisma.orderStatusHistory.create({
      data: { order_id: orden.id, from_status: null, to_status: 'new', changed_by: 'admin' },
    });
    await prisma.orderStatusHistory.create({
      data: { order_id: orden.id, from_status: 'new', to_status: 'preparing', changed_by: 'admin' },
    });

    await prisma.order.delete({ where: { id: orden.id } });

    expect(
      await prisma.orderStatusHistory.count({ where: { order_id: orden.id } }),
    ).toBe(0);
  });

  it('la migración no modificó ninguna columna existente de orders', async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='orders'`,
    );
    const presentes = filas.map((f) => f.column_name);
    for (const columna of [
      'id',
      'order_number',
      'status',
      'created_at',
      'delivered_at',
    ]) {
      expect(presentes).toContain(columna);
    }
    // NOTA (2026-09-05, US-010 T1.1): el ancla negativa de más abajo (`confirmed_at`/
    // `cancelled_at` "nunca existieron") reflejaba el estado del 2026-08-30, cuando
    // `US-010-orden-webhook-stock-backend` todavía no estaba construido — no era una
    // prohibición permanente, sino "no existen TODAVÍA" (design.md §D3 de este change).
    // US-010 las agregó a propósito, de forma aditiva (migración
    // `20260905201343_add_order_confirmed_cancelled_at`): la FSM necesita distinguir
    // "orden creada" de "orden confirmada" (el pago puede aprobarse horas después),
    // y "orden cancelada" (AC-4/AC-11) de cualquier otro estado. El resto de esta
    // aserción (las 5 columnas de arriba) sigue vigente sin cambios.
  });
});
