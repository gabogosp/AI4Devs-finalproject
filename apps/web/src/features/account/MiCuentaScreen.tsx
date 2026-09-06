'use client';

import { useState } from 'react';
import { AccountDeletedNotice } from './AccountDeletedNotice';
import { AccountPanel } from './AccountPanel';
import { CustomerGuard } from './CustomerGuard';

/**
 * US-020 §D3: levanta el flag "recién borrada" por ENCIMA de `CustomerGuard`,
 * NO como estado interno de `AccountPanel`.
 *
 * `CustomerGuard` retorna `null` en el MISMO render en el que `state.kind`
 * pasa a `'anonymous'`, ANTES de que su `useEffect` de redirección llegue a
 * ejecutarse. Si el flujo de éxito viviera DENTRO del árbol que el guard
 * protege, el mensaje de confirmación nunca llegaría a pintarse: el
 * siguiente render de React ejecutaría `CustomerGuard` con la sesión ya
 * anónima y ocultaría sus `children` de inmediato.
 *
 * La solución: `deleted` vive en un componente HERMANO del guard. Al
 * confirmar con éxito, `session.accountDeleted()` (sube el árbol, en
 * `SessionProvider`) y `setDeleted(true)` (acá) se disparan en el MISMO
 * manejador síncrono de evento — React 18 los agrupa en un solo render.
 * React re-renderiza de arriba hacia abajo: este componente se re-evalúa
 * primero, ve `deleted === true`, y su árbol devuelto ya NO incluye
 * `<CustomerGuard>` — el guard ni siquiera llega a re-renderizarse con el
 * nuevo `state.kind`. Sin carrera, sin parpadeo.
 */
export function MiCuentaScreen() {
  const [deleted, setDeleted] = useState(false);

  if (deleted) return <AccountDeletedNotice />;

  return (
    <CustomerGuard>
      <AccountPanel onAccountDeleted={() => setDeleted(true)} />
    </CustomerGuard>
  );
}
