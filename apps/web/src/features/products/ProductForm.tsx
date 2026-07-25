'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { AppErrorException } from '@/lib/http/errors';
import { formatArs } from '@/lib/format/currency';
import type { Category } from '@/features/categories/categoriesService';
import {
  productsService,
  type Product,
} from './productsService';

const schema = z.object({
  sku: z.string().min(1, 'El SKU es requerido'),
  name: z.string().min(1, 'El nombre es requerido'),
  price: z.coerce.number().positive('El precio debe ser mayor a 0'),
  stock: z.coerce.number().int().min(0, 'El stock no puede ser negativo'),
  category_id: z.string().uuid('Elegí una categoría'),
  description_raw: z.string().optional(),
  image_url: z.string().url('URL inválida').optional().or(z.literal('')),
});
type FormValues = z.input<typeof schema>;

// Los errores 422 del backend vienen por nombre de columna; se mapean al campo del form.
const FIELD_MAP: Record<string, keyof FormValues> = {
  sku: 'sku',
  name: 'name',
  price_ars_cents: 'price',
  stock: 'stock',
  category_id: 'category_id',
  image_url: 'image_url',
};

export function ProductForm({
  categories,
  initial,
  onSaved,
}: {
  categories: Category[];
  initial?: Product;
  onSaved?: (product: Product) => void;
}) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sku: initial?.sku ?? '',
      name: initial?.name ?? '',
      price: initial ? initial.price_ars_cents / 100 : undefined,
      stock: initial?.stock ?? 0,
      category_id: initial?.category_id ?? '',
      description_raw: initial?.description_raw ?? '',
      image_url: initial?.image_url ?? '',
    },
  });
  const [banner, setBanner] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const isEdit = Boolean(initial);

  async function onSubmit(values: FormValues): Promise<void> {
    setBanner(null);
    setSuccess(null);
    const price = typeof values.price === 'string' ? Number(values.price) : values.price;
    const stock = typeof values.stock === 'string' ? Number(values.stock) : values.stock;
    const common = {
      name: values.name,
      price_ars_cents: Math.round(price * 100),
      stock,
      category_id: values.category_id,
      description_raw: values.description_raw || undefined,
      image_url: values.image_url || undefined,
    };
    try {
      const saved = isEdit
        ? await productsService.update(initial!.id, common)
        : await productsService.create({ ...common, sku: values.sku });
      if (!isEdit) {
        setSuccess('Creado en borrador — no visible hasta publicar.');
      }
      onSaved?.(saved);
    } catch (err) {
      if (!(err instanceof AppErrorException)) {
        setBanner('No se pudo guardar. Intentá de nuevo.');
        return;
      }
      const e = err.appError;
      if (e.kind === 'conflict') {
        setBanner('Ya existe un producto con ese SKU.');
        setError('sku', { message: 'Ya existe un producto con ese SKU' });
      } else if (e.kind === 'validation') {
        setBanner('Revisá los campos marcados.');
        for (const fe of e.fieldErrors) {
          const target = FIELD_MAP[fe.field];
          if (target) setError(target, { message: fe.message });
        }
      } else if (e.kind === 'notFound') {
        setBanner('El producto ya no existe.');
      } else {
        setBanner('No se pudo guardar. Intentá de nuevo.');
      }
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label={isEdit ? 'Editar producto' : 'Nuevo producto'}
      className="flex flex-col gap-3"
    >
      {banner && (
        <div role="alert" className="rounded-sm bg-error-subtle p-3 text-error">
          {banner}
        </div>
      )}
      {success && (
        <div
          role="status"
          className="rounded-sm bg-success-subtle p-3 text-success"
        >
          {success}
        </div>
      )}

      <Field label="SKU" error={errors.sku?.message} required>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={Boolean(errors.sku)}
            disabled={isEdit}
            {...register('sku')}
          />
        )}
      </Field>

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
        label="Precio (ARS)"
        error={errors.price?.message}
        hint="IVA incluido"
        required
      >
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            type="number"
            step="0.01"
            aria-describedby={describedBy}
            invalid={Boolean(errors.price)}
            {...register('price')}
          />
        )}
      </Field>
      {isEdit && (
        <p className="text-xs text-muted">
          Precio actual: {formatArs(initial!.price_ars_cents)} (IVA incluido)
        </p>
      )}

      <Field label="Stock" error={errors.stock?.message} required>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            type="number"
            aria-describedby={describedBy}
            invalid={Boolean(errors.stock)}
            {...register('stock')}
          />
        )}
      </Field>

      <Field label="Categoría" error={errors.category_id?.message} required>
        {({ inputId, describedBy }) => (
          <Select
            id={inputId}
            aria-describedby={describedBy}
            invalid={Boolean(errors.category_id)}
            {...register('category_id')}
          >
            <option value="">Elegí una categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Descripción" error={errors.description_raw?.message}>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            {...register('description_raw')}
          />
        )}
      </Field>

      <Field label="URL de imagen" error={errors.image_url?.message}>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={Boolean(errors.image_url)}
            {...register('image_url')}
          />
        )}
      </Field>

      <Button type="submit" loading={isSubmitting}>
        {isEdit ? 'Guardar' : 'Crear en borrador'}
      </Button>
    </form>
  );
}
