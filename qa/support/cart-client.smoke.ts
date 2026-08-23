import { nuevoInvitado, reabrir } from './cart-client';
import { seedCarrito } from './seed-carrito';

function assert(condicion: boolean, mensaje: string): void {
  if (!condicion) throw new Error(mensaje);
}

/** Smoke de T1.2: recorre las cinco propiedades que los escenarios asumen. */
async function main(): Promise<void> {
  const s = await seedCarrito();
  const slug = s.mixtoA.slug;

  const invitado = await nuevoInvitado();

  // 1) Primera escritura sin CSRF: no hay cookie que secuestrar todavía.
  const primera = await invitado.fijar(slug, 1, { conCsrf: false });
  assert(primera.status === 200, `primera escritura: se esperaba 200, llegó ${primera.status}`);

  // 2) Segunda escritura CON el token derivado de la cookie.
  const segunda = await invitado.fijar(slug, 2);
  assert(segunda.status === 200, `segunda con CSRF: se esperaba 200, llegó ${segunda.status}`);

  // 3) Segunda escritura SIN el token: tiene que ser rechazada. Sin este caso,
  //    el cliente podría estar esquivando el CSRF sin que nadie lo note.
  const sinToken = await invitado.fijar(slug, 3, { conCsrf: false });
  assert(
    sinToken.status === 403,
    `escritura sin CSRF teniendo cookie: se esperaba 403, llegó ${sinToken.status}`,
  );

  const antes = await invitado.ver();
  assert(antes.body.id !== null, 'el carrito debería existir tras la primera escritura');

  // 4) Cerrar y volver: mismo carrito.
  const vuelto = await reabrir(invitado);
  const despues = await vuelto.ver();
  assert(
    despues.body.id === antes.body.id,
    `tras reabrir se esperaba el carrito ${antes.body.id}, llegó ${despues.body.id}`,
  );
  assert(
    despues.body.item_count === antes.body.item_count,
    'tras reabrir cambió la cantidad de ítems',
  );

  // 5) Un invitado nuevo NO ve ese carrito: la identidad no se filtra.
  const otro = await nuevoInvitado();
  const suyo = await otro.ver();
  assert(suyo.status === 200, `invitado nuevo: se esperaba 200, llegó ${suyo.status}`);
  assert(suyo.body.id === null, `invitado nuevo debería ver carrito vacío, vio ${suyo.body.id}`);

  await vuelto.cerrar();
  await otro.cerrar();

  console.log(
    `OK: identidad, CSRF (200/200/403), reapertura (${antes.body.id}) y aislamiento entre invitados`,
  );
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
