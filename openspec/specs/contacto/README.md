# Capacidad: Canal de contacto / soporte — WhatsApp (CAP-12)

**Estado**: entregada — enlace de WhatsApp presente en toda página pública del storefront.

Estado declarado del sistema para la capacidad CAP-12 del PRD §2.1 (fila 78, prioridad
*Should*). Este directorio es el **acumulado** de los changes archivados: se extiende en cada
`/archive-change`, nunca se reescribe.

## Qué está vivo hoy

Un canal de contacto por WhatsApp (`wa.me`, sin API de WhatsApp Business, sin backend
propio — E2E §55) presente en:

- **Header** del storefront (`(storefront)/layout.tsx`), a la derecha del wordmark.
- **Footer** del storefront (`SiteFooter`, primer footer del sitio) — nombre y dirección del
  local además del enlace.
- **Ficha de producto sin stock** (heredado de US-003): mensaje prellenado referenciando el
  producto consultado.

Todo montado en el layout del route group `(storefront)`; **ausente** de `(admin)` y `(auth)`
(superficie privada del dueño, ADR-0010 — ofrecer el canal ahí sería ruido, no señal de
confianza).

Fuente única del enlace: `apps/web/src/features/contact/whatsapp.ts` —
`whatsappHref(message?)` es la **única** función del repo que compone una URL `wa.me`;
`WhatsAppLink.tsx` es el componente presentacional que la consume (nunca compone URLs por su
cuenta). El número sale de `NEXT_PUBLIC_WHATSAPP_PHONE` (Zod, sólo dígitos).

Server Components sin JS de cliente (header, footer): cero costo de bundle en páginas
públicas. `ProductPurchase` (Client Component, US-003) consume la misma pieza.

## Qué NO está vivo todavía

- **Chatbot / API de WhatsApp Business** — roadmap del PRD, fuera de alcance de CAP-12.
- **Notificaciones transaccionales por WhatsApp** — van por email (US-011 / CAP-6).
- **Número real de producción** — el guard de despliegue (ver Decisiones) bloquea publicar
  con el placeholder de fábrica; el número real es una acción pendiente del PO/cliente antes
  del primer deploy (US-019).
- **Horarios de atención del local en el footer** — dato del dueño, pregunta abierta.
- **Links legales en el footer** — `Deferred: US-017` (CAP-10/CAP-13).
- **`TrustSignals` completo** (sello de pago seguro, mini-mapa, "retirás y revisás") — sólo
  la señal del canal humano está entregada; el resto depende de US-008/US-009 (CAP-4).

## Contratos

Ninguno. CAP-12 no tiene superficie REST propia — es un enlace `<a href="https://wa.me/…">`
resuelto enteramente por el servicio de terceros de WhatsApp; no hay API de DSM involucrada
(AC-4). No aplica `contracts/openapi.yaml`.

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-018-contacto-whatsapp-frontend-web`](../../changes/archive/US-018-contacto-whatsapp-frontend-web/) | FE | Fuente única del enlace (`whatsapp.ts` + `WhatsAppLink`), header, footer nuevo, guard de ausencia de red (AC-4), guard del placeholder de fábrica pre-deploy |

## Estado de la provisión

No requiere infraestructura propia — `wa.me` es un servicio público de terceros. El único
gate operativo es no publicar en producción (US-019) con el número placeholder de fábrica.
