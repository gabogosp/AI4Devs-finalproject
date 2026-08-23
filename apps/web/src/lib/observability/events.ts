export type BusinessEvent =
  | 'bo_screen_shown'
  | 'product_created'
  | 'product_published'
  | 'product_archived'
  | 'category_created'
  // Storefront público: una vista de ficha. El backend no la ve por cada
  // visita (la caché por tag le ahorra el request), así que su `product.viewed`
  // subcuenta — OQ-FE-5.
  | 'pdp_shown'
  // Storefront público: una vista de página de categoría. Mismo razonamiento
  // que `pdp_shown` — con la caché por tag, el `category.viewed` del backend
  // sólo ve los re-fetches post-invalidación y subcuenta estructuralmente.
  | 'category_shown'
  // Storefront público: salida hacia el canal humano desde la ficha. Mide
  // demanda perdida cuando no hay stock, y —desde el CTA del MVP— el camino de
  // compra real mientras el carrito no exista.
  | 'whatsapp_click'
  // Auth de cliente (US-014). Ninguno lleva email, nombre, id de cliente ni
  // valor de cookie: son eventos de la superficie pública y el email es PII
  // (observability-standards §9). `login_failed` va sin propiedades a
  // propósito — cualquier discriminador reintroduciría por telemetría la
  // distinción que AC-5 borra en la respuesta.
  | 'account_registered'
  | 'login_succeeded'
  | 'login_failed'
  | 'logout'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'session_expired';

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

/**
 * Eventos de la superficie PÚBLICA: los emite un visitante anónimo, no un
 * operador. Sin esta distinción, el `operator_id: 'admin'` por defecto
 * etiquetaría cada vista de ficha como acción del dueño y ensuciaría las
 * métricas de US-016.
 */
const PUBLIC_EVENTS: ReadonlySet<BusinessEvent> = new Set<BusinessEvent>([
  'pdp_shown',
  'category_shown',
  'whatsapp_click',
  'account_registered',
  'login_succeeded',
  'login_failed',
  'logout',
  'password_reset_requested',
  'password_reset_completed',
  'session_expired',
]);

export function track(event: BusinessEvent, props: EventProps = {}): void {
  const base: EventProps = PUBLIC_EVENTS.has(event) ? {} : { operator_id: 'admin' };
  sink(event, { ...base, ...props });
}
