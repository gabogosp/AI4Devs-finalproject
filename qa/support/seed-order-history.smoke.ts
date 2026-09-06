import {
  compraLogueada,
  compraLogueadaPendiente,
  sembrarProductoPublicado,
} from './seed-order-history';

interface OrderHistoryListResponse {
  data: Array<{ order_number: number; status: string }>;
  pagination: { limit: number; offset: number; total: number };
}

/**
 * Smoke de T0.1 (`tasks.md`): siembra una cuenta real, compra, confirma, y
 * falla si la orden no aparece en su propio historial o si aparece con
 * estado `pending_payment` — y lo mismo para `compraLogueadaPendiente`,
 * al revés (nunca debe aparecer).
 */
async function main(): Promise<void> {
  const slug = await sembrarProductoPublicado();
  console.log(`  producto sembrado: ${slug}`);

  const compra = await compraLogueada(slug);
  console.log(`  compraLogueada: order_number=${compra.orderNumber}`);

  const listado = (await (
    await compra.sesion.ctx.get('/v1/me/orders')
  ).json()) as OrderHistoryListResponse;
  if (listado.data.length !== 1) {
    throw new Error(
      `compraLogueada: se esperaba exactamente 1 orden en el historial, hubo ${listado.data.length}`,
    );
  }
  if (listado.data[0]!.order_number !== compra.orderNumber) {
    throw new Error(
      `compraLogueada: el order_number del historial (${listado.data[0]!.order_number}) ` +
        `no coincide con el de la compra (${compra.orderNumber})`,
    );
  }
  if (listado.data[0]!.status === 'pending_payment') {
    throw new Error('compraLogueada: la orden confirmada quedó en pending_payment');
  }
  console.log(`  OK: aparece en el historial con status=${listado.data[0]!.status}`);

  const pendiente = await compraLogueadaPendiente(slug);
  console.log(`  compraLogueadaPendiente: order_number=${pendiente.orderNumber}`);
  const listadoPendiente = (await (
    await pendiente.sesion.ctx.get('/v1/me/orders')
  ).json()) as OrderHistoryListResponse;
  if (listadoPendiente.data.length !== 0) {
    throw new Error(
      `compraLogueadaPendiente: se esperaba 0 órdenes en el historial (pending_payment excluida), ` +
        `hubo ${listadoPendiente.data.length}`,
    );
  }
  console.log('  OK: la orden pending_payment NO aparece en su propio historial');

  console.log('OK: seed-order-history cubre compraLogueada + compraLogueadaPendiente');
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
