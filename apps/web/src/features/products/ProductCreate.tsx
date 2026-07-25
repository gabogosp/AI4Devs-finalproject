'use client';

import { useEffect, useState } from 'react';
import { ProductForm } from './ProductForm';
import {
  categoriesService,
  type Category,
} from '@/features/categories/categoriesService';

/** Contenedor de alta (carga las categorías para el select). */
export function ProductCreate() {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    categoriesService
      .list(controller.signal)
      .then(setCategories)
      .catch(() => setCategories([]));
    return () => controller.abort();
  }, []);

  return (
    <section className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Nuevo producto</h1>
      <ProductForm categories={categories} />
    </section>
  );
}
