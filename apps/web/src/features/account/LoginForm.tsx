'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { AppErrorException } from '@/lib/http/errors';
import { track } from '@/lib/observability/events';
import { sanitizeNext } from '@/lib/http/customerSession';
import { accountService } from './accountService';
import { useSession } from './SessionProvider';
import { emailSchema } from './passwordSchema';
import {
  COPY_GENERICO,
  COPY_LOGIN_401,
  COPY_RED,
  copyRateLimited,
} from './authCopy';

// El login NO valida largo ni forma de la contraseña: hacerlo le diría al
// atacante qué contraseñas ni vale la pena probar, y a un usuario con una
// contraseña vieja le impediría entrar. Sólo se exige que no esté vacía.
const schema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'La contraseña es requerida'),
});
type FormValues = z.input<typeof schema>;

/**
 * Ingreso (US-014 AC-2/AC-5/AC-10).
 *
 * AC-5 es la razón de ser de este componente: contraseña incorrecta, cuenta
 * inexistente y cuenta bloqueada llegan como el **mismo** 401 y se tratan en
 * una sola rama — sin `setError` de ningún campo, sin navegar, y con el evento
 * `login_failed` **sin propiedades**. Cualquier discriminador reintroduciría
 * por la UI o por telemetría la distinción que el backend borró.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { onAuthenticated } = useSession();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const [banner, setBanner] = useState<string | null>(null);

  async function onSubmit(values: FormValues): Promise<void> {
    setBanner(null);
    try {
      const customer = await accountService.login(values);
      onAuthenticated(customer);
      track('login_succeeded');
      // Sin `?next=` el destino es la cuenta; con `?next=` se usa el saneado.
      // Se distinguen los dos casos porque `sanitizeNext(null)` devuelve `/`,
      // que es un destino válido y por lo tanto ganaría sobre el default.
      // El saneo importa: `?next=https://evil.tld` convertiría el login en una
      // primitiva de phishing (T0.6).
      const next = searchParams.get('next');
      router.replace(next ? sanitizeNext(next) : '/mi-cuenta');
    } catch (err) {
      if (!(err instanceof AppErrorException)) {
        setBanner(COPY_GENERICO);
        return;
      }
      const e = err.appError;
      if (e.kind === 'unauthorized') {
        // AC-5: una sola rama para los tres casos. Constante, no `e.message`.
        setBanner(COPY_LOGIN_401);
        track('login_failed');
      } else if (e.kind === 'rateLimited') {
        setBanner(copyRateLimited(e.retryAfterSeconds));
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

      <Field label="Email" error={errors.email?.message} required>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            type="email"
            aria-describedby={describedBy}
            autoComplete="username"
            {...register('email')}
          />
        )}
      </Field>

      <Field label="Contraseña" error={errors.password?.message} required>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            type="password"
            aria-describedby={describedBy}
            autoComplete="current-password"
            {...register('password')}
          />
        )}
      </Field>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Ingresando…' : 'Ingresar'}
      </Button>
    </form>
  );
}
