# Proposal — Edición de perfil del cliente (nombre + avatar por URL)

> **Ticket**: US-024 — Edición de perfil del cliente
> **Author**: frontend-web-developer agent (asistido por @gabogosp)
> **Date**: 2026-09-06
> **Status**: Proposed
> **Affected layers**: components, repository (HTTP client generado), state (`SessionProvider`), observability
> **Affected platform**: web (Next.js — `stacks.web.framework: nextjs` en `docs/project-config.yml`)

## Why

"Mi cuenta" (US-014, Done) muestra el nombre y el email del cliente pero no
deja editarlos — ni para corregir una errata al registrarse. Es un hallazgo
directo de la prueba visual del dueño, no una capacidad del PRD (`prd-capacity:
null`, mismo patrón que US-009/US-022): la brecha entre "la cuenta existe" y
"la cuenta se siente propia".

El dueño confirmó explícitamente (2026-09-06) el alcance acotado: nombre +
avatar **por URL pegada**, nunca upload real de archivo — no existe ningún
cliente R2/S3 cableado en el código pese a que `R2_*` aparece en `.env`, y
construir ese pipeline desde cero no se justifica para esta US. El precedente
exacto ya vive en el código: `ProductForm.tsx` acepta `image_url` de la misma
forma para productos.

## What

Agrega un formulario de edición de perfil dentro de `/mi-cuenta`
(`AccountPanel.tsx`), sustituyendo el nombre estático por un campo editable +
un campo de URL de avatar, reusando los componentes `Field`/`Input`/`Button`
del design-system y el patrón de validación de `ProductForm.tsx`. El email
sigue de sólo lectura (AC-6). Cuando no hay avatar configurado (o la URL se
borra), se muestra un placeholder de iniciales sobre un color determinístico
derivado del id del cliente — sin librería nueva, sin persistir nada
adicional.

El guardado exitoso refleja el nuevo nombre de inmediato tanto en la propia
pantalla como en el resto de la UI que lee la sesión (`AccountMenu.tsx` en el
header), extendiendo `SessionProvider` con un método `updateCustomer`.

## Out of scope

- **Upload real de archivo** (elegir imagen del dispositivo, procesarla,
  guardarla en R2/S3) — decisión explícita del dueño (US §4).
- **Cambiar email o contraseña** desde esta pantalla (US §4).
- **Perfil público / visible a otros clientes** (US §4).
- **Moderación de contenido del avatar** — se valida la forma de la URL, no el
  contenido de la imagen (US §4, NFR §9).
- **Verificación server-side de que la URL responde / es una imagen real** —
  decisión NFR explícita para evitar SSRF (ver `## Standards consultados`).
  El browser del propio cliente es quien intenta cargar la imagen; si falla,
  se degrada al placeholder (`frontend-resilience-patterns` #11 — image error
  fallback), no es un error del sistema.
- **Un endpoint/rewrite nuevo** — `PATCH /v1/me` cae bajo el rewrite
  same-origin `/v1/me/:path*` que ya existe desde US-020 (method-agnostic);
  no hay trabajo de topología nuevo, sólo una verificación E2E de que también
  cubre `PATCH`.
- **Un change de QA propio** — la US declara `disciplines: [BE, FE, QA]` pero
  fija explícitamente que la automatización vive dentro de FE/BE (US §7,
  mismo criterio que US-014/US-017). Este change incluye la cobertura L1-L3
  correspondiente (unit, componente, a11y, E2E) en su propio `tasks.md`.

## Affected components / screens

- `apps/web/src/features/account/ProfileForm.tsx` — **nuevo**. Formulario de
  edición (nombre + avatar URL).
- `apps/web/src/features/account/AccountPanel.tsx` — modificado: sustituye el
  `dd` estático de "Nombre" por `<ProfileForm>`; mantiene email/fecha de alta
  de sólo lectura.
- `apps/web/src/features/account/accountService.ts` — nuevo método
  `updateProfile(input)` sobre la operación generada de `PATCH /v1/me`.
- `apps/web/src/features/account/SessionProvider.tsx` — nuevo método de
  contexto `updateCustomer(patch)` para reflejar el cambio sin releer `/auth/me`.
- `apps/web/src/lib/observability/events.ts` — 3 eventos nuevos
  (`profile_edit_attempted/succeeded/failed`), en `PUBLIC_EVENTS`, sin PII.
- `apps/web/src/components/ui/Avatar.tsx` — **nuevo**. Componente compartido
  (iniciales + color determinístico, o `<img>` con fallback `onError`).
- `apps/web/src/lib/format/avatar.ts` — **nuevo**. Helpers puros:
  `initialsFrom(name)`, `avatarColor(id)`.
- `apps/web/e2e/profile-edit-topology.spec.ts` — **nuevo**. Prueba contra la
  app construida que `PATCH /v1/me` sale por el rewrite same-origin con CSRF.
- `apps/web/src/features/checkout/CheckoutForm.tsx` — modificado: precarga
  `buyer.name` con el nombre de la sesión activa cuando el cliente está
  logueado (AC-1, segunda mitad — hallazgo del 2026-09-06, confirmado con
  07: hoy este componente no tiene NINGUNA noción de sesión, `defaultValues`
  arranca `buyer.name: ''` siempre, incluso logueado). Sigue editable — un
  cliente logueado puede comprar para otra persona; la precarga es un
  default, no un valor fijo.

## API consumption

- `PATCH /v1/me` — **en construcción en paralelo por la disciplina backend de
  esta misma US** (`US-024-edicion-perfil-cliente-backend`, sesión 07). No
  existe todavía en `apps/api/docs/api/openapi.yaml` en este worktree: el
  `Customer` schema no tiene `avatar_url` y el path `/me` sólo declara
  `delete` (de US-020). Este change consume el contrato **sibling en el
  monorepo** (`apps/api/docs/api/openapi.yaml`) vía `orval`
  (`frontend-standards.md` §3.1/§3.2) — nunca escribe DTOs/Zod a mano.
- `GET /auth/me` (ya vivo, US-014) — sin cambio de endpoint, pero su schema
  `Customer` compartido gana el campo `avatar_url` cuando el backend lo
  publique; el frontend no necesita tocar `accountService.me()`.
- Ver `openspec/specs/cuentas/contracts/openapi.yaml` (CAP-6, estado vivo
  actual, sin `avatar_url` ni `PATCH /me` todavía) y
  `openspec/specs/retencion-datos-personales/` (donde vive hoy `DELETE /me`,
  US-020) para el precedente de forma del path `/me`.

## Acceptance criteria

Copiadas literalmente de `docs/user-stories/US-024-edicion-perfil-cliente.md`
§3 (7 AC en Gherkin — 4 happy/alternative + 3 negative-space):

- [ ] AC-1: editar el nombre — se refleja de inmediato en pantalla **y** en
  `buyer.name` del próximo checkout logueado (confirmado con 07, 2026-09-06:
  el backend NUNCA deriva `orders.buyer_name` de `Customer.name` — sale
  siempre de lo que manda el form de `CheckoutForm.tsx`, que hoy arranca
  siempre vacío, sin ninguna noción de sesión. La segunda mitad de este AC es
  enteramente responsabilidad de este change — ver T2.5/T3.8 nuevas).
- [ ] AC-2: agregar/cambiar el avatar por URL — reemplaza el placeholder.
- [ ] AC-3: quitar el avatar (borrar la URL) — vuelve al placeholder, sin URL rota.
- [ ] AC-4: nombre vacío o sólo espacios es rechazado, el nombre anterior se mantiene.
- [ ] AC-5: URL de avatar inválida (no-URL o esquema ≠ http/https) es rechazada, el avatar anterior se mantiene.
- [ ] AC-6 (negative-space): el email es de sólo lectura, sin ningún control para cambiarlo.
- [ ] AC-7 (negative-space, garantía cruzada BE/FE): ningún parámetro de la request (body/query/path) permite apuntar a otro cliente — el FE nunca envía un id; el backend opera siempre sobre `req.customer.id` de la sesión.

## Standards consultados

- `docs/base-standards.md` — principios core, vocabulario prescriptivo.
- `docs/code/frontend-standards.md` §3.1-3.4 (codegen obligatorio, DTO↔domain),
  §11.3 (error mapping), §11.4 (unión discriminada de estado), §11.5
  (repository pattern), §11.9 (composición de loading-state), §12.1-12.2
  (XSS/validación cliente+servidor).
- `docs/code/frontend-next-standards.md` — overlay Next (`stacks.web.framework:
  nextjs`); sin impacto nuevo (la sesión de cliente ya es 100% Client
  Component desde US-014, `openspec/specs/cuentas/requirements.md` R-15/N-9).
- `docs/architecture/api-standards.md` §3.2 (PATCH semántica), §10
  (Idempotency-Key "recomendado", no aplicado aquí — ver `design.md`).
- `docs/cross-cutting/security-standards.md` §6.5 (SSRF — "import from URL"):
  la mitigación elegida es NO hacer fetch server-side de la URL en absoluto
  (el NFR de la US lo declara explícitamente), consistente con la regla.
- `docs/quality/testing-standards.md` §14 (patrones de test).
- `docs/quality/qa-frontend-standards.md` §19 (a11y), §23 (Vitest+RTL+MSW+Playwright).
- Skills: `openapi-client-codegen`, `frontend-resilience-patterns` (#11 image
  error fallback), `msw-setup`, `playwright-stability`, `openspec-workflow`.

## Open questions

- **OQ-FE-1 (bloqueante de ejecución, no de diseño)**: el contrato real de
  `PATCH /v1/me` (operationId, forma exacta del body/response — `Customer`
  plano vs `{customer: Customer}`) depende de
  `US-024-edicion-perfil-cliente-backend` (sesión 07, en paralelo, todavía sin
  mergear en este worktree). El `design.md` asume la forma más consistente con
  el resto de `/me` (`Customer` plano, igual que `GET /auth/me`) pero
  **Fase 0 de `tasks.md` reconcilia contra el `design.md`/PR real de 07 antes
  de escribir `accountService.updateProfile`** — mismo patrón ya usado en este
  repo para US-010/US-012/US-020 (ver `docs/_index/openspec-changes.yaml`).
- **OQ-FE-2 (decisión de UX, con default aplicado)**: ¿el preview del avatar
  se actualiza en vivo mientras se tipea la URL, o sólo después de guardar
  con éxito? Default elegido: **sólo después de guardar** (usa
  `customer.avatar_url` del estado de sesión ya confirmado por el backend) —
  más simple, evita renderizar contenido no confirmado, y AC-2/AC-3 no exigen
  live-preview. Revisable por el PO sin bloquear el plan.

## Índice de documentación

Este proposal no requiere ADR (no hay decisión arquitectónica nueva — reusa
patrones ya establecidos de `ProductForm.tsx`/`DeleteAccountSection.tsx`). Se
actualiza `openspec/specs/cuentas/` en el `/archive-change` de este change
(sección "Desde US-024 frontend-web"), no en este documento.
