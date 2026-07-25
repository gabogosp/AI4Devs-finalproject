'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AppErrorException } from '@/lib/http/errors';
import {
  productsService,
  type Product,
  type ProductStatus,
} from './productsService';

const FIELD_LABELS: Record<string, string> = {
  name: 'nombre',
  price_ars_cents: 'precio',
  stock: 'stock',
  category_id: 'categoría',
};

/** Acciones de estado del producto: publicar (AC-4/AC-6) y archivar (AC-7). */
export function ProductActions({
  product,
  onChanged,
}: {
  product: Product;
  onChanged?: (p: Product) => void;
}) {
  const [status, setStatus] = useState<ProductStatus>(product.status);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function publish(): Promise<void> {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const updated = await productsService.publish(product.id);
      setStatus(updated.status); // solo cambia si el backend confirmó
      setMessage('Producto publicado.');
      onChanged?.(updated);
    } catch (err) {
      if (
        err instanceof AppErrorException &&
        err.appError.kind === 'validation'
      ) {
        // AC-6: pesimista — el producto PERMANECE en draft; mostramos qué falta.
        setMissing(
          err.appError.fieldErrors.map((f) => FIELD_LABELS[f.field] ?? f.field),
        );
      } else {
        setMessage('No se pudo publicar.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function archive(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await productsService.archive(product.id);
      setStatus(updated.status);
      setConfirmOpen(false);
      setMessage('Producto archivado.');
      onChanged?.(updated);
    } catch {
      setMessage('No se pudo archivar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span data-testid="product-status">{status}</span>
      {message && <div role="status">{message}</div>}
      {missing && (
        <div role="alert">
          Faltan datos para publicar: {missing.join(', ')}.
        </div>
      )}

      <div className="flex gap-2">
        {status === 'draft' && (
          <Button onClick={() => void publish()} loading={busy}>
            Publicar
          </Button>
        )}
        {status !== 'archived' && (
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            Archivar
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Archivar producto"
        description="Sale del listado activo. No se borra: se puede consultar históricamente."
        confirmWord="ARCHIVAR"
        confirmLabel="Archivar"
        onConfirm={() => void archive()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
