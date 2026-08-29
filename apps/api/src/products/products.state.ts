import { FieldError, InvalidTransitionError } from '../common/errors/domain-errors';

/**
 * Máquina de transición de estado de productos — TS plano (sin tipos de
 * framework), testeable en unit. AC-4 (publicar), AC-6 (publicar incompleto
 * rechazado), AC-7 (archivar sin borrar).
 */
export type ProductStatus = 'draft' | 'published' | 'archived';

export const PRODUCT_STATUSES: ProductStatus[] = [
  'draft',
  'published',
  'archived',
];

const VALID_TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  draft: ['published', 'archived'],
  published: ['archived', 'draft'],
  archived: [], // terminal en US-001 (reactivar no es un AC de esta US)
};

export interface PublishRequirements {
  name: string | null;
  price_ars_cents: number | null;
  stock: number | null;
  category_id: string | null;
}

/** Lanza si `from → to` no es una transición válida. */
export function assertValidTransition(
  from: ProductStatus,
  to: ProductStatus,
): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(
      `Transición de estado inválida: ${from} → ${to}`,
    );
  }
}

/** AC-6: al publicar, exige name + price>0 + stock>=0 + category. Lanza listando qué falta. */
export function assertPublishable(p: PublishRequirements): void {
  const missing: FieldError[] = [];
  if (!p.name || p.name.trim() === '') {
    missing.push({ field: 'name', message: 'requerido para publicar' });
  }
  if (p.price_ars_cents == null || p.price_ars_cents <= 0) {
    missing.push({
      field: 'price_ars_cents',
      message: 'requerido y > 0 para publicar',
    });
  }
  if (p.stock == null || p.stock < 0) {
    missing.push({ field: 'stock', message: 'requerido para publicar' });
  }
  if (!p.category_id) {
    missing.push({ field: 'category_id', message: 'requerida para publicar' });
  }
  if (missing.length > 0) {
    throw new InvalidTransitionError(
      'El producto no cumple los requisitos para publicarse',
      missing,
    );
  }
}
