'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { AppErrorException } from '@/lib/http/errors';
import { track } from '@/lib/observability/events';
import { accountService } from './accountService';
import { emailSchema } from './passwordSchema';
import {
  COPY_GENERICO,
  COPY_RED,
  COPY_RESET_REQUESTED,
  copyRateLimited,
} from './authCopy';

const schema = z.object({ email: emailSchema });
type FormValues = z.input<typeof schema>;

/**
 * Solicitud de recuperación (US-014 AC-11).
 *
 * La confirmación es **una sola** y no depende de si la cuenta existe — el
 * frontend ni siquiera puede saberlo, porque el backend responde 202 en ambos
 * casos, y no debe intentar averiguarlo. Por eso tampoco se ofrece un
 * "¿no te llegó? fijate si tenés cuenta": esa variante insinúa existencia y
 * convierte la pantalla en un verificador de emails registrados.
 */
export function ResetRequestForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const [banner, setBanner] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(values: FormValues): Promise<void> {
    setBanner(null);
    try {
      await accountService.requestReset({ email: values.email });
      setDone(COPY_RESET_REQUESTED);
      track('password_reset_requested');
    } catch (err) {
      if (!(err instanceof AppErrorException)) {
        setBanner(COPY_GENERICO);
        return;
      }
      const e = err.appError;
      if (e.kind === 'rateLimited') setBanner(copyRateLimited(e.retryAfterSeconds));
      else if (e.kind === 'network') setBanner(COPY_RED);
      else setBanner(COPY_GENERICO);
    }
  }

  if (done) {
    return (
      <p role="status" className="rounded-md bg-surface-2 p-3 text-sm text-fg">
        {done}
      </p>
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

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Enviando…' : 'Enviar link de recuperación'}
      </Button>
    </form>
  );
}
