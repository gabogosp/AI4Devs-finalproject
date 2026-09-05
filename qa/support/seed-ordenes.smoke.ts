import { crearOrdenEnEstado, prismaDeSiembra } from './seed-ordenes';

/**
 * Smoke de D2/OQ-QA-1: siembra una orden en cada estado que la suite de
 * aceptación necesita y verifica lo que los escenarios asumen. La excepción
 * DECLARADA del acceso directo al ORM (una sola línea en todo el archivo, a
 * diferencia de `seed-carrito.smoke.ts` que assertea su ausencia total) la
 * verifica el `Verify:` de T1.1 en `tasks.md` (`grep -c` sobre el archivo),
 * no este script — acá sólo se prueba el comportamiento.
 */
async function main(): Promise<void> {
  const pendingPayment = await crearOrdenEnEstado('pending_payment');
  if (pendingPayment.status !== 'pending_payment') {
    throw new Error(`pending_payment: se esperaba pending_payment, quedó ${pendingPayment.status}`);
  }
  console.log(`  pending_payment  order_number=${pendingPayment.orderNumber}`);

  const nueva = await crearOrdenEnEstado('new');
  console.log(`  new              order_number=${nueva.orderNumber}`);

  const preparando = await crearOrdenEnEstado('preparing');
  console.log(`  preparing        order_number=${preparando.orderNumber}`);

  const lista = await crearOrdenEnEstado('ready');
  console.log(`  ready            order_number=${lista.orderNumber}`);

  const entregada = await crearOrdenEnEstado('delivered');
  console.log(`  delivered        order_number=${entregada.orderNumber}`);

  const cancelada = await crearOrdenEnEstado('cancelled');
  console.log(`  cancelled        order_number=${cancelada.orderNumber}`);

  // Verificación directa contra la base: los 6 estados quedaron donde se pidieron.
  const filas = await prismaDeSiembra.order.findMany({
    where: {
      id: {
        in: [
          pendingPayment.id,
          nueva.id,
          preparando.id,
          lista.id,
          entregada.id,
          cancelada.id,
        ],
      },
    },
    select: { id: true, status: true },
  });
  const porId = new Map(filas.map((f) => [f.id, f.status]));
  const esperado: Array<[string, string]> = [
    [pendingPayment.id, 'pending_payment'],
    [nueva.id, 'new'],
    [preparando.id, 'preparing'],
    [lista.id, 'ready'],
    [entregada.id, 'delivered'],
    [cancelada.id, 'cancelled'],
  ];
  for (const [id, esp] of esperado) {
    if (porId.get(id) !== esp) {
      throw new Error(`orden ${id}: se esperaba status=${esp}, quedó ${porId.get(id)}`);
    }
  }

  console.log('OK: seed-ordenes cubre los 6 estados que la suite necesita');
  await prismaDeSiembra.$disconnect();
}

main().catch(async (err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  await prismaDeSiembra.$disconnect();
  process.exit(1);
});
