'use client';

import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { track } from '@/lib/observability/events';
import Link from 'next/link';
import { checkoutBannerFor } from './checkoutCopy';
import { checkoutResolver, type CheckoutFormValues } from './checkoutResolver';
import type { CheckoutCreated } from './checkoutService';
import { ConsentCheckbox } from './ConsentCheckbox';
import { useCheckout } from './useCheckout';

export interface CheckoutFormProps {
  onSuccess: (order: CheckoutCreated) => void;
}

const DEFAULT_VALUES: CheckoutFormValues = {
  buyer: { name: '', email: '', phone: '' },
  // `false` a propósito: el schema exige `literal(true)` (AC-4), así que arranca
  // inválido hasta que la persona lo marque.
  consent: false as unknown as true,
  fulfillment: 'pickup',
};

/**
 * El formulario (AC-1, AC-3, AC-4). RHF + `checkoutResolver` (T1.2, no
 * `zodResolver` directo) + `Field`/`Input` existentes — mismo patrón que
 * `RegisterForm.tsx` (US-014). `fulfillment` es un campo **oculto** con valor
 * fijo (D6 — sucursal única, sin control elegible).
 */
export function CheckoutForm({ onSuccess }: CheckoutFormProps) {
  const { state, submit } = useCheckout();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CheckoutFormValues>({ resolver: checkoutResolver, defaultValues: DEFAULT_VALUES });

  const consent = watch('consent');
  const notificado = useRef(false);
  const eventoRegistrado = useRef(false);

  useEffect(() => {
    if (state.kind === 'success' && !notificado.current) {
      notificado.current = true;
      track('checkout_succeeded', { order_number: state.order.order_number });
      onSuccess(state.order);
    }
  }, [state, onSuccess]);

  // 422 del servidor: marca EL campo que vino en fieldErrors, ninguno más — un
  // banner genérico que no señale dónde deja a la persona adivinando.
  useEffect(() => {
    if (state.kind !== 'error' || state.error.kind !== 'validation') return;
    let primero: string | undefined;
    for (const fe of state.error.fieldErrors) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(fe.field as any, { type: 'server', message: fe.message });
      primero ??= fe.field;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (primero) setFocus(primero as any);
  }, [state, setError, setFocus]);

  useEffect(() => {
    if (state.kind === 'error' && !eventoRegistrado.current) {
      eventoRegistrado.current = true;
      track('checkout_failed', { error_kind: state.error.kind });
    }
    if (state.kind === 'submitting') eventoRegistrado.current = false;
  }, [state]);

  async function onSubmit(values: CheckoutFormValues): Promise<void> {
    track('checkout_submitted');
    await submit(values);
  }

  const submitting = state.kind === 'submitting';
  const banner = state.kind === 'error' ? checkoutBannerFor(state.error) : null;

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
    >
      {banner && (
        <p role="alert" className="rounded-md bg-error-soft p-3 text-sm text-error">
          {banner.message}{' '}
          {banner.linkToCart && (
            <Link href="/carrito" className="underline">
              Ir al carrito
            </Link>
          )}
        </p>
      )}

      <Field label="Nombre" error={errors.buyer?.name?.message} required>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            autoComplete="name"
            {...register('buyer.name')}
          />
        )}
      </Field>

      <Field label="Email" error={errors.buyer?.email?.message} required>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            type="email"
            aria-describedby={describedBy}
            autoComplete="email"
            {...register('buyer.email')}
          />
        )}
      </Field>

      <Field label="Teléfono" error={errors.buyer?.phone?.message} required>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            type="tel"
            aria-describedby={describedBy}
            autoComplete="tel"
            {...register('buyer.phone')}
          />
        )}
      </Field>

      <input type="hidden" {...register('fulfillment')} />

      <p className="text-sm text-muted">Retirás en el local: Av. Córdoba y Av. Pueyrredón.</p>

      <ConsentCheckbox
        inputId="checkout-consent"
        checked={consent === true}
        onChange={(checked) => setValue('consent', checked as true, { shouldValidate: false })}
        error={errors.consent?.message}
      />

      <Button type="submit" variant="accent" disabled={submitting} aria-busy={submitting || undefined}>
        {submitting ? 'Confirmando…' : 'Confirmar pedido'}
      </Button>
    </form>
  );
}
