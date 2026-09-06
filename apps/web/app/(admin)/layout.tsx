import type { ReactNode } from 'react';
import { AdminGuard } from '@/features/auth/guard';
import { AdminNav } from '@/features/auth/AdminNav';

// El route group (admin) queda gated: sin sesión admin, el guard redirige a
// /acceso antes de renderizar cualquier pantalla del panel (AC-8).
//
// `AdminNav` (A1): el layout sólo tenía el guard, sin ningún punto de
// navegación entre secciones ni de cierre de sesión — encontrado real cuando
// el dueño no tenía forma de "volver" desde Importar salvo editar la URL.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGuard>
      <AdminNav />
      {/* Cada pantalla ya trae su propio padding (`p-6`) — sólo se centra acá,
          mismo `max-w-5xl` que ya usa `AdminNav` y el storefront. */}
      <div className="mx-auto max-w-5xl">{children}</div>
    </AdminGuard>
  );
}
