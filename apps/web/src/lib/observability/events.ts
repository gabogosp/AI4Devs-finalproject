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
  // Checkout del invitado (US-008). Superficie de invitado, sin `operator_id`
  // (`design.md` D11). Sin PII y sin el `order_token`: `order_number` es un
  // contador público, mismo criterio que en la respuesta del backend.
  | 'checkout_started'
  | 'checkout_blocked'
  | 'checkout_submitted'
  | 'checkout_succeeded'
  | 'checkout_failed'
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
  | 'search_rate_limited'
  // Panel de fulfillment (US-012). Backoffice — van con `operator_id: 'admin'`,
  // no entran en PUBLIC_EVENTS. Nunca llevan `buyer_name`/`buyer_email`: el
  // `order_id` alcanza para correlacionar (mismo criterio que `OrderEventsService`
  // del backend, que tampoco los loguea).
  | 'order_status_change_attempted'
  | 'order_status_change_succeeded'
  | 'order_status_change_failed'
  | 'orders_filtered'
  // Vista de pendientes de pago (US-012 §D9, feature aditiva sobre el backend
  // hermano US-023). Sin `buyer_name`, mismo criterio que los eventos de
  // arriba.
  | 'pending_payment_confirmed'
  // Anonimización de una orden a pedido del comprador (US-021 AC-3, AC-9).
  // Backoffice — mismo criterio que `order_status_change_*`: sólo
  // `{ order_id }`, nunca `buyer_name`/`buyer_email`/`anonymization_reason`
  // (`design.md` §Observabilidad — el motivo no aporta a la analítica del
  // panel y mantener la misma forma que los otros tres eventos evita que
  // alguien agregue un campo de más mañana pensando que ya hay precedente).
  | 'order_anonymize_attempted'
  | 'order_anonymize_succeeded'
  | 'order_anonymize_failed'
  // Cancelación de una orden por el dueño (US-013 AC-1/AC-10). Backoffice —
  // mismo criterio que los eventos de arriba: sólo `{ order_id }`, nunca
  // `buyer_name`/`buyer_email`/detalle del reembolso.
  | 'order_cancel_attempted'
  | 'order_cancel_succeeded'
  | 'order_cancel_failed'
  // Panel de métricas (US-016 §9 — "registrar uso del panel"). Backoffice —
  // van con `operator_id: 'admin'`, no entran en PUBLIC_EVENTS.
  // `metrics_export_downloaded` lleva `{ dataset }` con un enum acotado a los
  // 3 datasets, nunca un rango de fechas: un rango libre en la propiedad
  // ensuciaría los breadcrumbs con cardinalidad libre
  // (`observability-patterns` skill §3.3).
  | 'metrics_shown'
  | 'metrics_range_changed'
  | 'metrics_export_downloaded'
  // Historial de compras del cliente (US-015). Superficie de cliente, no de
  // operador — van en `PUBLIC_EVENTS`, mismo criterio que `cart_viewed`.
  // Ninguno lleva PII: `OrderHistorySummary`/`OrderHistoryDetail` no tienen
  // `buyer_name`/`buyer_email`/`buyer_phone` en su shape (a diferencia de
  // `AdminOrderSummary`), así que no hay nada que filtrar por accidente.
  | 'order_history_shown'
  | 'order_history_load_more_clicked'
  | 'order_detail_shown'
  | 'order_detail_not_found'
  // Borrado de cuenta y datos personales (US-020 AC-1/AC-4/AC-9/AC-14).
  // Superficie de cliente, no de operador — van en `PUBLIC_EVENTS`, mismo
  // criterio que `order_history_*`. Sin PII: ninguno lleva nombre, email,
  // teléfono ni el detalle (`order_number`/importe) de los pedidos
  // bloqueantes — sólo el nombre del evento, mismo criterio que
  // `login_failed`.
  | 'account_delete_attempted'
  | 'account_delete_succeeded'
  | 'account_delete_blocked'
  | 'account_delete_failed';

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
  // Los emite un cliente sin cuenta, no el dueño — mismo criterio que los de
  // auth: sin esto quedarían etiquetados como acción del dueño.
  'checkout_started',
  'checkout_blocked',
  'checkout_submitted',
  'checkout_succeeded',
  'checkout_failed',
  // Los emite el cliente autenticado leyendo su propio historial — no el
  // dueño. Mismo criterio que los de auth/checkout.
  'order_history_shown',
  'order_history_load_more_clicked',
  'order_detail_shown',
  'order_detail_not_found',
  // Los emite el cliente autenticado borrando su propia cuenta — no el
  // dueño. Mismo criterio que los de auth/historial.
  'account_delete_attempted',
  'account_delete_succeeded',
  'account_delete_blocked',
  'account_delete_failed',
]);

export function track(event: BusinessEvent, props: EventProps = {}): void {
  const base: EventProps = PUBLIC_EVENTS.has(event) ? {} : { operator_id: 'admin' };
  sink(event, { ...base, ...props });
}
