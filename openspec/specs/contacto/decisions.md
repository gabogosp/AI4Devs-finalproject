# Decisions — Canal de contacto / soporte (CAP-12)

Decisiones de diseño tomadas por los changes archivados de esta capacidad. Detalle completo
en `openspec/changes/archive/US-018-contacto-whatsapp-frontend-web/design.md`.

## Fuente única del enlace (helper + componente)

`src/features/contact/whatsapp.ts` (función pura `whatsappHref(message?)` + catálogo de
mensajes) es el **único** lugar del repo que compone una URL `wa.me`. `WhatsAppLink.tsx` es
presentacional y sólo consume el href — nunca lo construye. Ningún ADR disparado: es
organización interna de una feature, reversible en minutos (`base-standards.md` §1).

## El panel del dueño no lleva el enlace

`(admin)` y `(auth)` no reciben el header/footer con WhatsApp. Consecuencia directa de
ADR-0010 (partición de audiencias público/privado): el dueño es quien atiende el WhatsApp, no
quien lo necesita. Verificado con E2E sobre el HTML servido de `/admin/*`.

## Header y footer como Server Components

`WhatsAppLink` y `SiteFooter` se escriben sin `"use client"` — no tienen estado ni handlers,
y evitar el bundle del cliente importa en páginas públicas con presupuesto de LCP
(`frontend-next-standards.md` §2). `ProductPurchase` (Client Component, US-003) arrastra el
módulo al bundle en esa ruta específica — correcto y esperado, el módulo no tiene código
server-only.

## AC-3 (apertura en escritorio) se verifica, no se construye

No hay detección de dispositivo. `wa.me` es un servicio de redirección de WhatsApp que
resuelve del lado de ellos si abrir la app móvil, WhatsApp Web o la app de escritorio. Se
blinda la **forma canónica** del href (sólo dígitos, sin `+` ni guiones, `wa.me/` y no
`api.whatsapp.com/send?phone=`) en vez de reimplementar una decisión que WhatsApp ya toma con
más información (`base-standards.md` §1 — KISS/YAGNI).

## AC-4 se prueba con un espía de red, no con un grep

El guard de "sin backend" (`noBackend.test.tsx`) espía `globalThis.fetch` durante el render
del footer, el header y la ficha sin stock, y falla si se invoca una sola vez. Un grep
estructural pasaría en verde incluso si el contacto terminara enrutado vía un servicio que
internamente llama a `customFetch` (F48).

## Guard de publicación con placeholder (OQ-FE-12, opción c)

El número placeholder de fábrica se bloquea en el **job de deploy**, no en el build — el
desarrollo y los tests corren sin fricción contra el placeholder; sólo la publicación a
producción exige el número real. El enganche al pipeline real queda `Deferred: US-019`
(provisión de nube).

## Referencias

- ADR: `docs/architecture/decisions/0010-url-namespace-storefront-vs-admin.md`
- Design completo: `openspec/changes/archive/US-018-contacto-whatsapp-frontend-web/design.md`
