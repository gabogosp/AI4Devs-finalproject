'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { AppErrorException } from '@/lib/http/errors';
import { adminSession } from './adminSession';

/**
 * Acceso admin mínimo (OQ-FE-1 opción A). Postea el token al seam del backend;
 * en éxito redirige al panel; en 401 muestra un error accionable sin filtrar
 * detalle. US-014 lo reemplaza por login real sin tocar el guard/servicios.
 */
export function AdminAccessForm() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminSession.login(token);
      router.push('/admin/productos');
    } catch (err) {
      setError(
        err instanceof AppErrorException && err.appError.kind === 'unauthorized'
          ? 'Token de acceso inválido.'
          : 'No se pudo iniciar sesión. Intentá de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Acceso al panel de administración"
      className="mx-auto flex max-w-sm flex-col gap-4 p-6"
    >
      <h1 className="text-2xl font-bold">Acceso al panel</h1>
      <Field label="Token de acceso" error={error ?? undefined}>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            type="password"
            aria-describedby={describedBy}
            invalid={Boolean(error)}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" loading={loading}>
        Entrar
      </Button>
    </form>
  );
}
