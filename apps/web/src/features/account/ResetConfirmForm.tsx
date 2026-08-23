'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { AppErrorException } from '@/lib/http/errors';
import { track } from '@/lib/observability/events';
import { accountService } from './accountService';
import { passwordSchema } from './passwordSchema';
import {
  COPY_GENERICO,
  COPY_RED,
  COPY_RESET_TOKEN_INVALIDO,
  copyRateLimited,
} from './authCopy';

/** `type` del catálogo cerrado del backend para un token de reset inservible. */
const TOKEN_INVALIDO_TYPE = 'dsm:auth/invalid-reset-token';

const schema = z.object({ password: passwordSchema });
type FormValues = z.input<typeof schema>;

/**
 * Fijar la contraseña nueva (US-014 AC-4/AC-7).
 *
 * Dos cosas que no son obvias:
 *
 * - **El token sale de la URL apenas se lee.** Mientras esté ahí viaja en el
 *   `Referer` de cualquier recurso externo, queda en el historial y puede
 *   entrar a telemetría. Es una credencial de un solo uso: cuanto menos viva en
 *   la barra de direcciones, mejor.
 * - **Vencido, usado e inexistente comparten mensaje** (AC-7). Distinguirlos
 *   diría si el token existió alguna vez, que es información sobre las cuentas.
 */
export function ResetConfirmForm() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [tokenMuerto, setTokenMuerto] = useState(false);
  const [listo, setListo] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    const t = searchParams.get('token');
    setToken(t);
    if (t && typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [searchParams]);

  async function onSubmit(values: FormValues): Promise<void> {
    setBanner(null);
    if (!token) {
      setTokenMuerto(true);
      return;
    }
    try {
      await accountService.confirmReset({ token, password: values.password });
      setListo(true);
      // Sin el token ni el email: el evento sólo dice que pasó.
      track('password_reset_completed');
    } catch (err) {
      if (!(err instanceof AppErrorException)) {
        setBanner(COPY_GENERICO);
        return;
      }
      const e = err.appError;
      if (e.kind === 'validation' && e.problemType === TOKEN_INVALIDO_TYPE) {
        // 400 del backend: vencido, usado o inexistente, indistinguibles entre
        // sí. Se separa del 422 por el `type` del envelope y no por si trae o
        // no `fieldErrors`, que sería adivinar por la forma.
        setTokenMuerto(true);
      } else if (e.kind === 'validation') {
        // Un 422 NO consume el token: la contraseña era débil, el enlace sigue
        // sirviendo y el usuario puede reintentar sin pedir otro.
        setBanner('Revisá la contraseña.');
        for (const fe of e.fieldErrors) {
          if (fe.field === 'password') setError('password', { message: fe.message });
        }
      } else if (e.kind === 'rateLimited') {
        setBanner(copyRateLimited(e.retryAfterSeconds));
      } else if (e.kind === 'network') {
        setBanner(COPY_RED);
      } else {
        setBanner(COPY_GENERICO);
      }
    }
  }

  if (tokenMuerto) {
    return (
      <div role="alert" className="flex flex-col gap-3">
        <p className="text-sm text-fg">{COPY_RESET_TOKEN_INVALIDO}</p>
        <Link href="/recuperar" className="text-sm underline">
          Pedir un link nuevo
        </Link>
      </div>
    );
  }

  if (listo) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="text-sm text-fg">Listo, ya podés ingresar con tu contraseña nueva.</p>
        {/* El backend NO abre sesión al confirmar, a propósito: quien tenga el
            link no queda logueado por el solo hecho de abrirlo. */}
        <Link href="/ingresar" className="text-sm underline">
          Ingresar
        </Link>
      </div>
    );
  }

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
    >
      {banner && (
        <p role="alert" className="rounded-md bg-error-soft p-3 text-sm text-error">
          {banner}
        </p>
      )}

      <Field
        label="Contraseña nueva"
        error={errors.password?.message}
        hint="Al menos 8 caracteres"
        required
      >
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            type="password"
            aria-describedby={describedBy}
            autoComplete="new-password"
            {...register('password')}
          />
        )}
      </Field>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Guardando…' : 'Guardar contraseña'}
      </Button>
    </form>
  );
}
