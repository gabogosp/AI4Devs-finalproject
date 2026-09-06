---
tracker-id: null
tracker-source: null
parent-us: US-024
discipline: backend
variant: null
language: es
---

# US-024 Backend — Edición de perfil del cliente

## Why

`AccountPanel.tsx` (US-014) ya muestra nombre/email/teléfono del cliente pero
declara honestamente que nombre y foto no son editables — hallazgo directo de
la prueba visual del dueño (US-024 §2). Hoy no existe ningún endpoint que
escriba sobre `customers.name` después del registro; corregir una errata en el
nombre no tiene forma de hacerse. Esta US cierra esa brecha con el endpoint
más chico posible: un `PATCH /v1/me` que reusa exactamente el mismo seam
estructural de identidad que `DELETE /v1/me` (US-020) — el `customerId` sale
únicamente de `req.customerId` (sesión), nunca de un parámetro del request
(AC-7).

El avatar es por URL pegada, no upload real — decisión explícita del dueño
(US-024 §10) tras conocer el costo de un pipeline de subida real (no hay
cliente R2/S3 en el código pese a que `R2_*` aparece en `.env`). Replica el
patrón ya usado por `image_url` de producto (`products.repository.ts`), pero
con una diferencia deliberada: el AC-5 de esta US exige rechazar valores como
`"no-es-url"` o un esquema distinto de http/https, algo que el validador de
`image_url` (`@IsString()` suelto) NO hace hoy — acá sí se valida forma de URL
(`@IsUrl`), porque el AC lo pide explícitamente.

## What changes

- **Migración aditiva de una columna nullable**: `customers.avatar_url
  VARCHAR(2048)`, sin default — el placeholder (iniciales + color) es
  puramente de presentación en el FE, no se persiste. Caso trivial de
  persistencia (una columna, sin índice nuevo, sin relación) — no amerita
  invocar `data-architect` Mode B.
- **`PATCH /v1/me`** — nuevo endpoint en el `AccountController` ya existente
  (US-020), mismo par de guards que `DELETE /v1/me` (`CustomerGuard,
  CsrfGuard`). Body `{ name: string, avatar_url: string | null }` — ambos
  campos siempre presentes (form completo, mismo patrón que `ProductForm`):
  `name` no vacío/no sólo-espacios (AC-4), `avatar_url` es `null` para borrar
  el avatar (AC-3) o una URL http/https válida para setearlo (AC-2); cualquier
  otro valor no-null es rechazado (AC-5, 422). Responde 200 con el
  `CustomerResponseDto` actualizado (ahora incluye `avatar_url`).
- **`CustomersRepository.updateProfile()`** — nuevo método, mismo idioma
  `updateMany` guardado por `deleted_at: null` que `anonymize()` (US-020): si
  la fila no está activa, `null` → el controller responde 401 (sesión
  stale), consistente con el fail-closed de `CustomerGuard`.
- **`CustomerResponseDto`** gana `avatar_url: string | null` — se propaga a
  TODOS los endpoints que ya devuelven este DTO (`GET /v1/auth/me`,
  `register`, `login`, y el nuevo `PATCH /v1/me`), campo aditivo — ningún
  consumidor FE existente se rompe (Zod no-estricto ignora campos nuevos).
- **Contrato OpenAPI**: `PATCH /me` documentado bajo el tag `account`;
  `Customer` schema gana `avatar_url` (required, nullable); nuevo
  `UpdateProfileRequest` schema.

## Scope — ACs cubiertos

| AC | Cubierto por |
|---|---|
| AC-1 (editar nombre) | `PATCH /v1/me` actualiza `name` y se refleja de inmediato en la respuesta. **Segunda cláusula del AC ("aparece en órdenes futuras") es FE-owned, no backend**: verificado en `create-checkout.dto.ts`/`checkout.controller.ts` que `orders.buyer_name` sale SIEMPRE de `body.buyer.name` — un campo que el formulario de checkout envía explícitamente, nunca derivado server-side de `Customer.name`. El backend no tiene lógica que fijar acá; que el checkout registrado pre-llene ese campo con el nombre YA actualizado es responsabilidad del formulario de checkout en el FE (a1) — se lo señalo al avisar el contrato. |
| AC-2 (setear avatar) | `avatar_url` válida → 200, columna actualizada |
| AC-3 (quitar avatar) | `avatar_url: null` → 200, columna vuelve a `null` |
| AC-4 (nombre vacío rechazado) | `@Length(1,120)` post-trim → 422, fila sin cambios |
| AC-5 (URL inválida rechazada) | `@IsUrl({protocols:['http','https'], require_protocol:true})` → 422, fila sin cambios |
| AC-6 (email no editable, negative-space) | El DTO no declara `email`; con `forbidNonWhitelisted:true` global, enviarlo es 422, no ignorado en silencio |
| AC-7 (no edita perfil ajeno, negative-space) | Identidad SOLO de `req.customerId`; sin params de ruta/query que acepten un id |

## Standards consultados

- `api-standards.md` — RFC 7807, 422 para validación, versionado `/v1`.
- `security-standards.md` §7 — identidad estructural desde sesión, nunca de
  input del cliente (mismo criterio que US-020).
- `data-standards.md` — migración aditiva, columna nullable sin default.

## Open questions

Ninguna — 5 decisiones de producto ya cerradas por el dueño en la US §10
(nombre+avatar juntos, avatar por URL, sin upload real, sin perfil público, sin
moderación de contenido).
