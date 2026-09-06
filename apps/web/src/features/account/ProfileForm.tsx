'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { AppErrorException } from '@/lib/http/errors';
import { track } from '@/lib/observability/events';
import { COPY_GENERICO, COPY_RED, copyRateLimited } from './authCopy';
import { accountService, type Customer } from './accountService';
import { useSession } from './SessionProvider';

/**
 * Pattern replicado de `ProductForm.tsx` (línea 25) —
 * `image_url: z.string().url('URL inválida').optional().or(z.literal(''))` —
 * **endurecido** con un `.refine` de esquema http/https: `.url()` sólo valida
 * que la cadena sea sintácticamente una URL, y acepta `data:`/`javascript:`/
 * `ftp:` — AC-5 exige rechazar explícitamente cualquier esquema que no sea
 * http/https.
 */
const httpUrl = z
  .string()
  .url('URL inválida')
  .refine(
    (v) => {
      try {
        return ['http:', 'https:'].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    },
    { message: 'La URL debe empezar con http:// o https://' },
  );

const schema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido'),
  avatar_url: httpUrl.optional().or(z.literal('')),
});
type FormValues = z.input<typeof schema>;

const FIELD_MAP: Record<string, keyof FormValues> = {
  name: 'name',
  avatar_url: 'avatar_url',
};

/**
 * Edición de nombre + avatar (US-024 AC-1/AC-2/AC-3/AC-4/AC-5). Vive en
 * `AccountPanel.tsx`, HERMANO del `dl` de sólo lectura (email/fecha de
 * alta) — nunca dentro de él (AC-6 se cumple por ausencia: el email no tiene
 * ningún control acá).
 *
 * `avatar_url: ''` en el form se manda como `null` al backend (AC-3, "quitar
 * el avatar") — el contrato exige `null`, no una cadena vacía.
 */
export function ProfileForm({ customer }: { customer: Customer }) {
  const { updateCustomer } = useSession();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: customer.name, avatar_url: customer.avatar_url ?? '' },
  });
  const [banner, setBanner] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(values: FormValues): Promise<void> {
    setBanner(null);
    setSuccess(null);
    track('profile_edit_attempted');
    try {
      const updated = await accountService.updateProfile({
        name: values.name,
        avatar_url: values.avatar_url || null,
      });
      updateCustomer({ name: updated.name, avatar_url: updated.avatar_url });
      setSuccess('Perfil actualizado.');
      track('profile_edit_succeeded');
    } catch (err) {
      track('profile_edit_failed');
      if (!(err instanceof AppErrorException)) {
        setBanner(COPY_GENERICO);
        return;
      }
      const e = err.appError;
      if (e.kind === 'validation') {
        setBanner('Revisá los campos marcados.');
        for (const fe of e.fieldErrors) {
          const target = FIELD_MAP[fe.field];
          if (target) setError(target, { message: fe.message });
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

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="Editar perfil"
      className="flex flex-col gap-3"
    >
      {banner && (
        <p role="alert" className="rounded-md bg-error-soft p-3 text-sm text-error">
          {banner}
        </p>
      )}
      {success && (
        <p role="status" className="rounded-md bg-success-subtle p-3 text-sm text-success">
          {success}
        </p>
      )}

      <Field label="Nombre" error={errors.name?.message} required>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={Boolean(errors.name)}
            {...register('name')}
          />
        )}
      </Field>

      <Field
        label="Avatar (URL)"
        error={errors.avatar_url?.message}
        hint="Pegá el link de una imagen. Dejalo vacío para volver al placeholder."
      >
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={Boolean(errors.avatar_url)}
            {...register('avatar_url')}
          />
        )}
      </Field>

      <Button type="submit" loading={isSubmitting} className="self-start">
        Guardar
      </Button>
    </form>
  );
}
