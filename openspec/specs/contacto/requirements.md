# Requirements — Canal de contacto / soporte (CAP-12)

Acumulado de los ACs entregados por los changes archivados de esta capacidad. Fuente: PRD
§2.1 fila 78, `docs/user-stories/US-018-contacto-whatsapp.md`.

## Funcionales

- **AC-1 — Visibilidad global**: en toda página pública del storefront (header y footer), el
  cliente encuentra un botón/enlace de WhatsApp. — `US-018`
- **AC-2 — Consulta desde ficha sin stock**: en la ficha de un producto sin stock, el contacto
  por WhatsApp abre un mensaje inicial que referencia el producto consultado. — `US-003`
  (construido), preservado por `US-018` vía refactor *behavior-preserving*.
- **AC-3 — Apertura en escritorio**: el enlace abre WhatsApp Web (o la app de escritorio)
  hacia el número del local. Resuelto por la forma canónica del `href`
  (`https://wa.me/<sólo-dígitos>[?text=]`); no hay detección de dispositivo propia — es el
  mecanismo que `wa.me` define para eso. — `US-018`
- **AC-5 — Fuente única / configurable**: el número de WhatsApp proviene de una única
  configuración (`NEXT_PUBLIC_WHATSAPP_PHONE`, validada con Zod); la URL `wa.me` se compone en
  un único punto del código (`whatsapp.ts`) — ningún otro archivo construye el literal. — `US-018`

## No funcionales / negative-space

- **AC-4 — Sin backend, sin datos sensibles**: el contacto se resuelve mediante el enlace
  estándar `wa.me`, sin llamar al backend de DSM en ningún paso, y el mensaje prellenado no
  incluye datos sensibles del comprador (precio, SKU, email, id de orden) — sólo el nombre del
  producto cuando aplica. Probado con un espía sobre `globalThis.fetch` (falla si se invoca
  una sola vez en el camino del contacto), no con un grep estructural. — `US-018`
- **Superficie privada excluida**: el enlace está **ausente** de `(admin)` y `(auth)` — el
  panel del dueño no lleva canal de atención al cliente (ADR-0010). Verificado por E2E sobre
  el HTML servido de `/admin/*`. — `US-018`
- **Cero JS de cliente adicional**: header y footer son Server Components; el enlace no
  agrega bundle de cliente a las páginas públicas. — `US-018`
- **Guard de publicación**: el número placeholder de fábrica (`5491100000000`) no puede
  llegar a producción — gate en el job de deploy (no en el build). Enganche al pipeline real:
  `Deferred: US-019`. — `US-018`

## Explícitamente fuera de alcance de CAP-12

- Chatbot / atención automatizada, API de WhatsApp Business.
- Notificaciones transaccionales por WhatsApp (van por email, CAP-6).
- Horarios de atención del local en el footer (dato del dueño, pregunta abierta).
- Links legales en el footer (`Deferred: US-017`, CAP-10/CAP-13).
- Resto del top-nav — buscador, carrito, cuenta (`Deferred: US-004 / US-007 / US-014`).
- `TrustSignals` completo — sello de pago seguro, mini-mapa, retiro (`Deferred: US-008 / US-009`).
- Número real de WhatsApp de producción — acción pendiente del PO/cliente antes del primer
  deploy (`Deferred: OQ-FE-3`, US-019).
