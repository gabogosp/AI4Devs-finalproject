'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * AC-7: un visitante sin cuenta no puede dejar reseña. Esto es UX — la
 * defensa real la hace el backend (401 sin cookie de sesión válida), mismo
 * criterio que `CustomerGuard.tsx`. `next=` codifica el pathname actual para
 * volver acá después de ingresar.
 */
export function ReviewGuestPrompt() {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 text-sm">
      <p>Necesitás una cuenta para dejar una reseña.</p>
      <div className="flex gap-4">
        <Link href="/crear-cuenta" className="font-medium text-primary underline">
          Crear una cuenta
        </Link>
        <Link
          href={`/ingresar?next=${encodeURIComponent(pathname)}`}
          className="font-medium text-primary underline"
        >
          Ya tengo cuenta, ingresar
        </Link>
      </div>
    </div>
  );
}
