import { adminAuth } from './admin-auth';
import { apiCall } from './api';
import {
  backdatearCreatedAt,
  catalogoParaMetricas,
  crearOrdenActiva,
  crearOrdenCanceladaPorStock,
  crearOrdenPendiente,
  prismaDeSiembra,
} from './seed-metricas';

/**
 * Smoke de `seed-metricas.ts` (qa-plan.md §6): siembra las 6 formas de orden
 * que X-1 necesita — TODAS por API real — y verifica el estado final leyendo
 * la API admin real (`GET /v1/admin/orders/{id}` o `.../pending-payment`),
 * nunca Prisma, salvo para la ÚNICA excepción documentada (backdate).
 */
async function main(): Promise<void> {
  const adminToken = await adminAuth();
  const catalogo = await catalogoParaMetricas(1, { token: adminToken });

  const pendiente = await crearOrdenPendiente({ adminToken, catalogo });
  const pendientes = await apiCall<Array<{ id: string }>>(
    '/v1/admin/orders/pending-payment',
    'GET',
    adminToken,
  );
  if (!pendientes.some((f) => f.id === pendiente.id)) {
    throw new Error('pending_payment: la orden no aparece en GET /pending-payment');
  }
  console.log(`  pending_payment  order_number=${pendiente.orderNumber}`);

  const nueva = await crearOrdenActiva('new', { adminToken, catalogo });
  const preparando = await crearOrdenActiva('preparing', { adminToken, catalogo });
  const lista = await crearOrdenActiva('ready', { adminToken, catalogo });
  const entregada = await crearOrdenActiva('delivered', { adminToken, catalogo });
  // Producto PROPIO (no el `catalogo` compartido): esta siembra baja el stock
  // a 0 a propósito — reusar el catálogo compartido dejaría sin stock a
  // cualquier siembra posterior que lo use.
  const cancelada = await crearOrdenCanceladaPorStock({ adminToken });

  const esperado: Array<[string, string]> = [
    [nueva.id, 'new'],
    [preparando.id, 'preparing'],
    [lista.id, 'ready'],
    [entregada.id, 'delivered'],
    [cancelada.id, 'cancelled'],
  ];
  for (const [id, esp] of esperado) {
    const detalle = await apiCall<{ status: string }>(`/v1/admin/orders/${id}`, 'GET', adminToken);
    if (detalle.status !== esp) {
      throw new Error(`orden ${id}: se esperaba status=${esp}, quedó ${detalle.status}`);
    }
    console.log(`  ${esp.padEnd(16)} order_number=OK id=${id}`);
  }

  // Única excepción del archivo (AC-9): backdate real, verificado vía Prisma
  // SOLO en este smoke (mismo criterio que seed-ordenes.smoke.ts).
  const paraBackdate = await crearOrdenActiva('new', { adminToken, catalogo });
  const fecha = new Date();
  fecha.setMonth(fecha.getMonth() - 13);
  await backdatearCreatedAt(paraBackdate.id, fecha);
  const fila = await prismaDeSiembra.order.findUniqueOrThrow({ where: { id: paraBackdate.id } });
  if (fila.created_at.getTime() !== fecha.getTime()) {
    throw new Error('backdatearCreatedAt: created_at no quedó en la fecha pedida');
  }
  console.log(`  backdate         created_at=${fila.created_at.toISOString()}`);

  console.log('OK: seed-metricas cubre las 6 formas de orden de X-1 + el backdate de AC-9');
  await prismaDeSiembra.$disconnect();
}

main().catch(async (err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  await prismaDeSiembra.$disconnect();
  process.exit(1);
});
