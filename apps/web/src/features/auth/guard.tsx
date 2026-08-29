'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { adminSession } from './adminSession';

/**
 * Guard UX del route group `(admin)` (AC-8). Sin sesión admin → redirige a la
 * página de acceso; no renderiza el panel para anónimo. NO es la autoridad — el
 * backend gatea server-side; esto evita mostrar UI de administración a quien no
 * tiene sesión.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    adminSession.restore();
    if (!adminSession.isAuthenticated()) {
      router.replace('/admin/acceso');
    } else {
      setAuthorized(true);
    }
  }, [router]);

  if (!authorized) return null;
  return <>{children}</>;
}
