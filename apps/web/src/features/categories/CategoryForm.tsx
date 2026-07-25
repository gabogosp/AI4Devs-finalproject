'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { AppErrorException } from '@/lib/http/errors';
import { categoriesService, type Category } from './categoriesService';

const schema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
});
type FormValues = z.infer<typeof schema>;

/**
 * Alta / edición de categoría (AC-1). El `slug` NO es campo editable (lo deriva
 * el server). 409 (slug duplicado) → banner; el input se preserva.
 */
export function CategoryForm({
  initial,
  onSaved,
}: {
  initial?: Category;
  onSaved?: (category: Category) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: initial?.name ?? '' },
  });
  const [banner, setBanner] = useState<string | null>(null);

  async function onSubmit(values: FormValues): Promise<void> {
    setBanner(null);
    try {
      const saved = initial
        ? await categoriesService.update(initial.id, values)
        : await categoriesService.create(values);
      onSaved?.(saved);
    } catch (err) {
      if (err instanceof AppErrorException && err.appError.kind === 'conflict') {
        setBanner('Ya existe una categoría con ese nombre.');
      } else if (
        err instanceof AppErrorException &&
        err.appError.kind === 'notFound'
      ) {
        setBanner('La categoría ya no existe.');
      } else {
        setBanner('No se pudo guardar. Intentá de nuevo.');
      }
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label={initial ? 'Editar categoría' : 'Nueva categoría'}
      className="flex flex-col gap-3"
    >
      {banner && (
        <div role="alert" className="rounded-sm bg-error-subtle p-3 text-error">
          {banner}
        </div>
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
      <Button type="submit" loading={isSubmitting}>
        {initial ? 'Guardar' : 'Crear'}
      </Button>
    </form>
  );
}
