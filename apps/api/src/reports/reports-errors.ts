import { DomainError } from '../common/errors/domain-errors';

/**
 * `created_at_from` posterior a `created_at_to` — entrada incoherente del
 * propio dueño, no una ventana que exceda la retención (eso se acota, no se
 * rechaza — ver `date-range.ts`). `per design.md §D5/§D9`.
 */
export class ReportsInvalidRangeError extends DomainError {
  readonly status = 422;
  readonly type = 'dsm:reports/invalid-range';

  constructor(from?: string, to?: string) {
    super(
      `Rango inválido: "${from ?? '(default)'}" es posterior a "${to ?? '(default)'}"`,
    );
  }
}
