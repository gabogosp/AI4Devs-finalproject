import type { ProductStatus } from './productsService';

// Texto + color (nunca color como único portador de estado — a11y §11).
const LABELS: Record<ProductStatus, { text: string; className: string }> = {
  draft: { text: 'Borrador', className: 'bg-gray-100 text-gray-700' },
  published: { text: 'Publicado', className: 'bg-success-subtle text-success' },
  archived: { text: 'Archivado', className: 'bg-warning-subtle text-warning' },
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  const label = LABELS[status];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${label.className}`}
    >
      {label.text}
    </span>
  );
}
