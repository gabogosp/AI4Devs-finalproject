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
  | 'session_expired'
  // Carrito del invitado (US-007). Sin PII y sin el token del carrito: el `slug`
  // del producto es público y no identifica a nadie. `cart_blocked_checkout` es el
  // interesante para el dueño — mide demanda perdida por falta de stock, la misma
  // señal que el backend emite del otro lado.
  //
  // Nombres en `snake_case` como el resto de este módulo; el plan los escribía
  // con punto (`cart.item_added`), que es la convención del BACKEND, no la de acá.
  | 'cart_item_added'
  | 'cart_quantity_changed'
  | 'cart_item_removed'
  | 'cart_viewed'
  | 'cart_blocked_checkout'
  // Import masivo (US-006). Eventos del TRABAJO, no de la fila: un import de 5.000
  // filas emite cuatro eventos como máximo, no 5.000. **Nunca** llevan el nombre
  // del archivo, un `sku` ni un motivo de rechazo: son datos del catálogo del
  // cliente, y los logs tienen menos controles de acceso que la base
  // (observability-standards §9). Son de backoffice, así que van con
  // `operator_id: 'admin'` — no entran en PUBLIC_EVENTS.
  | 'import_upload_submitted'
  | 'import_upload_rejected'
  | 'import_job_finished'
  | 'import_report_downloaded'
  // Búsqueda semántica (US-004). **El texto de la consulta no viaja en ninguno**
  // y es la regla dura de esta familia: el input es entrada libre, así que
  // alguien pega su email o su teléfono ahí y el volcado de telemetría se
  // convierte en un registro de PII (observability-standards §9). Lo que sí
  // viaja es `query_length`, que mide lo mismo que interesa —si la gente
  // describe o tipea dos palabras— sin guardar qué escribió.
  //
  // Medir *qué* busca la gente sigue siendo valioso para decidir el catálogo,
  // pero eso lo hace el backend, que ya tiene el texto y puede agregarlo con su
  // propia retención y sus propios controles de acceso.
  | 'search_performed'
  | 'search_result_clicked'
  | 'search_fallback_clicked'
  | 'search_rate_limited';

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
  // Los emite quien busca, que es un visitante anónimo: sin esto quedarían
  // etiquetados como acción del dueño y ensuciarían las métricas de US-016.
  'search_performed',
  'search_result_clicked',
  'search_fallback_clicked',
  'search_rate_limited',
]);

export function track(event: BusinessEvent, props: EventProps = {}): void {
  const base: EventProps = PUBLIC_EVENTS.has(event) ? {} : { operator_id: 'admin' };
  sink(event, { ...base, ...props });
}
