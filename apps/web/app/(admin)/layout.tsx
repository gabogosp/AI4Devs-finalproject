import type { ReactNode } from 'react';
import { AdminGuard } from '@/features/auth/guard';

// El route group (admin) queda gated: sin sesión admin, el guard redirige a
// /acceso antes de renderizar cualquier pantalla del panel (AC-8).
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
