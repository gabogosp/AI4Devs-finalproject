export type BusinessEvent =
  | 'bo_screen_shown'
  | 'product_created'
  | 'product_published'
  | 'product_archived'
  | 'category_created';

export interface EventProps {
  operator_id?: string;
  correlation_id?: string;
  [key: string]: unknown;
}

type Sink = (event: BusinessEvent, props: EventProps) => void;

// Sink por defecto no-op. En producción `initObservability` lo apunta a Sentry
// (breadcrumb + métrica). Sin PII de comprador (no aplica en backoffice).
let sink: Sink = () => {};

export function setEventSink(next: Sink): void {
  sink = next;
}

export function track(event: BusinessEvent, props: EventProps = {}): void {
  sink(event, { operator_id: 'admin', ...props });
}
