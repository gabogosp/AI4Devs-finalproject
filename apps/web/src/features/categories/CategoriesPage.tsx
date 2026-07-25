'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { CategoriesList } from './CategoriesList';
import { CategoryForm } from './CategoryForm';
import { categoriesService, type Category } from './categoriesService';

/** Contenedor de la pantalla de categorías (AC-1): listado + alta. */
export function CategoriesPage() {
  const [state, setState] = useState<AsyncState<Category[]>>({ status: 'idle' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await categoriesService.list();
      setState({ status: 'success', data });
    } catch (err) {
      setState({
        status: 'error',
        error:
          err instanceof AppErrorException ? err.appError : networkError(),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Categorías</h1>
      <CategoryForm onSaved={() => void load()} />
      <CategoriesList state={state} onRetry={() => void load()} />
    </section>
  );
}
