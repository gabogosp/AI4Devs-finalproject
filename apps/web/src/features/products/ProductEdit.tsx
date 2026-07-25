'use client';

import { useEffect, useState } from 'react';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { ProductForm } from './ProductForm';
import { ProductActions } from './ProductActions';
import { productsService, type Product } from './productsService';
import {
  categoriesService,
  type Category,
} from '@/features/categories/categoriesService';

/** Contenedor de edición (AC-3): precarga el producto + categorías. */
export function ProductEdit({ id }: { id: string }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [state, setState] = useState<AsyncState<Product>>({ status: 'idle' });

  useEffect(() => {
    const controller = new AbortController();
    categoriesService
      .list(controller.signal)
      .then(setCategories)
      .catch(() => setCategories([]));
    setState({ status: 'loading' });
    productsService
      .get(id, controller.signal)
      .then((p) => setState({ status: 'success', data: p }))
      .catch((err) =>
        setState({
          status: 'error',
          error:
            err instanceof AppErrorException ? err.appError : networkError(),
        }),
      );
    return () => controller.abort();
  }, [id]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div role="status" aria-busy="true" aria-live="polite">
        Cargando producto…
      </div>
    );
  }
  if (state.status === 'error') {
    return <div role="alert">No se pudo cargar el producto.</div>;
  }

  return (
    <section className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Editar producto</h1>
      <ProductActions product={state.data} />
      <ProductForm categories={categories} initial={state.data} />
    </section>
  );
}
