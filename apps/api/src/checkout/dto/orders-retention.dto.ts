import { AnonymizeResult } from '../orders-retention.service';

/**
 * Respuesta de `POST /v1/admin/orders/:id/anonymize` (T4.1) — construida
 * campo por campo, igual que `CheckoutResponseDto`: nunca se expone la
 * entidad ORM (`per backend-node-standards.md §4`).
 */
export class OrderAnonymizationResultDto {
  order_id!: string;
  anonymized_at!: string;
  anonymization_reason!: string;

  static from(orderId: string, result: AnonymizeResult): OrderAnonymizationResultDto {
    return {
      order_id: orderId,
      anonymized_at: result.anonymizedAt.toISOString(),
      anonymization_reason: result.anonymizationReason,
    };
  }
}

/** Respuesta de `POST /v1/admin/orders/retention-sweep` (T4.2). */
export class RetentionSweepResultDto {
  anonymized_count!: number;
  reason!: 'retention_policy';

  static from(anonymizedCount: number): RetentionSweepResultDto {
    return {
      anonymized_count: anonymizedCount,
      reason: 'retention_policy',
    };
  }
}
