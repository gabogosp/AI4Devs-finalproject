'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { AppErrorException } from '@/lib/http/errors';
import { track } from '@/lib/observability/events';
import { accountService } from './accountService';
import { useSession } from './SessionProvider';
import { emailSchema, passwordSchema } from './passwordSchema';
import {
  COPY_GENERICO,
  COPY_RED,
  COPY_REGISTER_409,
  copyRateLimited,
} from './authCopy';

const schema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  email: emailSchema,
  password: passwordSchema,
});
type FormValues = z.input<typeof schema>;

/**
 * Alta de cuenta con sesión inmediata (US-014 AC-1/AC-6/AC-10).
 *
 * La validación del cliente es UX; la de seguridad es del servidor
 * (`frontend-standards` §12.2). Por eso el `409` **no** marca el campo email:
 * hacerlo diría "ese email ya está registrado", que es exactamente lo que AC-6
 * prohíbe. El banner usa la constante y el campo queda limpio.
 */
export function RegisterForm() {
  const router = useRouter();
  const { onAuthenticated } = useSession();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const [banner, setBanner] = useState<string | null>(null);

  async function onSubmit(values: FormValues): Promise<void> {
    setBanner(null);
    try {
      const customer = await accountService.register({
        name: values.name,
        email: values.email,
        password: values.password,
      });
      onAuthenticated(customer);
      track('account_registered');
      // AC-1: queda con sesión activa, sin pasar por el login.
      router.replace('/mi-cuenta');
    } catch (err) {
      if (!(err instanceof AppErrorException)) {
        setBanner(COPY_GENERICO);
        return;
      }
      const e = err.appError;
      if (e.kind === 'conflict') {
        // AC-6: sin `setError('email')`. El copy no confirma la existencia.
        setBanner(COPY_REGISTER_409);
      } else if (e.kind === 'rateLimited') {
        // AC-10: se informa la espera y NO se reintenta.
        setBanner(copyRateLimited(e.retryAfterSeconds));
      } else if (e.kind === 'validation') {
        setBanner('Revisá los campos marcados.');
        for (const fe of e.fieldErrors) {
          if (fe.field === 'email' || fe.field === 'password' || fe.field === 'name') {
            setError(fe.field, { message: fe.message });
          }
        }
      } else if (e.kind === 'network') {
        setBanner(COPY_RED);
      } else {
        setBanner(COPY_GENERICO);
      }
    }
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

      <Field label="Nombre" error={errors.name?.message} required>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            autoComplete="name"
            {...register('name')}
          />
        )}
      </Field>

      <Field label="Email" error={errors.email?.message} required>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            type="email"
            aria-describedby={describedBy}
            // `username` acá y `new-password` abajo: sin esto, el gestor de
            // contraseñas ofrece la del sitio en vez de proponer una nueva.
            autoComplete="username"
            {...register('email')}
          />
        )}
      </Field>

      <Field
        label="Contraseña"
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
        {isSubmitting ? 'Creando cuenta…' : 'Crear cuenta'}
      </Button>
    </form>
  );
}
