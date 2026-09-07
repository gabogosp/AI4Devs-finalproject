---
type: user-story
id: US-024
slug: edicion-perfil-cliente
parent-prd: docs/product/prd.md
prd-capacity: null   # no nace del PRD §2.1: hallazgo de la prueba visual del dueño sobre
# "Mi cuenta" (US-014) — la pantalla mostraba los datos del cliente pero no permitía
# editarlos, algo que `AccountPanel.tsx` ya declaraba honestamente ("nombre" y "foto" no
# eran editables). Mismo patrón que US-009/US-022 (`prd-capacity: null`).
parent-e2e: docs/product/design-e2e.md
status: Done
priority: Medium
estimate-tshirt: S
story_points_traditional: 3
story_points_ai_assisted: 2
estimation_basis: "BE endpoint PATCH /me (nombre + avatar_url, migración de 1 columna nullable) + FE form reusando patrones de ProductForm (Cohn 2005 §8, 3), sin QA change propio (automatización dentro del FE) — Cohn 2005 §12, agregado × 0.6 (feature acotada, sin infra nueva)"
language: es
created: 2026-09-06
updated: 2026-09-06
ready-at: 2026-09-06
in-progress-at: 2026-09-06
done-at: 2026-09-07
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-024: Edición de perfil del cliente

## 1. La historia (formato Connextra)

**Como** cliente registrado de DSM,
**quiero** poder editar mi nombre y agregar una foto de perfil desde "Mi cuenta",
**para** que mi cuenta refleje quién soy, en vez de quedar fija con lo que puse al registrarme.

## 2. Por qué importa (Valuable)

Hoy "Mi cuenta" (US-014) muestra el nombre pero no deja cambiarlo — ni siquiera para corregir una errata al registrarse. Es la brecha más chica entre "la cuenta existe" y "la cuenta se siente propia": sin poder editar el perfil, la sensación es de un formulario, no de una cuenta.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: Editar el nombre
```gherkin
Given un cliente autenticado en "Mi cuenta"
When cambia su nombre a "Ana María Pérez" y guarda
Then el nombre se actualiza y se refleja de inmediato en la pantalla
And el nuevo nombre es el que aparece en órdenes futuras (buyer_name en checkout registrado)
```

### AC-2: Agregar/cambiar el avatar por URL
```gherkin
Given un cliente autenticado sin avatar configurado (placeholder por defecto)
When pega una URL de imagen válida (https, termina en extensión de imagen o responde content-type image/*) y guarda
Then el avatar se actualiza y reemplaza el placeholder
```

### AC-3: Quitar el avatar (volver al placeholder)
```gherkin
Given un cliente autenticado con un avatar ya configurado
When borra la URL y guarda
Then el avatar vuelve al placeholder por defecto (no queda una URL rota)
```

### AC-4: Nombre vacío es rechazado
```gherkin
Given un cliente autenticado editando su nombre
When intenta guardar el campo nombre vacío o sólo espacios
Then el sistema rechaza el cambio con un mensaje claro
And el nombre anterior se mantiene sin cambios
```

### AC-5: URL de avatar inválida es rechazada
```gherkin
Given un cliente autenticado editando su avatar
When pega un valor que no es una URL válida (ej. "no-es-url", o un esquema distinto de http/https)
Then el sistema rechaza el cambio con un mensaje claro
And el avatar anterior (o el placeholder) se mantiene
```

### AC-6 (negative-space): el email NO es editable acá
```gherkin
Given un cliente autenticado en "Mi cuenta"
When mira el formulario de edición de perfil
Then el campo email se muestra de sólo lectura
And no hay ningún control que permita cambiarlo desde esta pantalla
```

### AC-7 (negative-space): no se puede editar el perfil de otro cliente
```gherkin
Given un cliente autenticado con id "A"
When intenta enviar un PATCH a /v1/me con credenciales de otro cliente "B" (token robado/reusado no aplica — se prueba que el endpoint SIEMPRE opera sobre el customer_id de la sesión, nunca sobre uno recibido por parámetro)
Then el sistema actualiza únicamente los datos del cliente autenticado por el token de sesión
And no existe ningún parámetro de la request (body/query/path) que permita apuntar a otro id
```

## 4. Out of scope explícito

- **Upload real de archivo** (elegir imagen del dispositivo, procesarla, guardarla en R2/S3) — decisión explícita del dueño: el avatar es sólo una URL pegada, igual que `image_url` de producto hoy. Construir un pipeline de upload real es una US futura si se justifica.
- **Cambiar email o contraseña** desde esta pantalla — el email es la credencial de login (cambiarlo implicaría re-verificación, fuera de alcance); la contraseña ya tiene su propio flujo (`recuperar`, US-014).
- **Perfil público / visible a otros clientes** — el nombre y avatar del cliente sólo se muestran a sí mismo en "Mi cuenta" (y como `buyer_name` interno en sus propias órdenes/panel del dueño). No hay perfil público en v1. Si US-025 (reseñas) necesita mostrar el nombre del reviewer, se referencia desde ahí, no se duplica acá.
- **Moderación de contenido del avatar** (verificar que la imagen sea apropiada) — igual que `image_url` de producto: se valida la forma (URL bien formada, accesible), no el contenido.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende únicamente de que exista `Customer` (US-014, ya Done) — no bloquea ni es bloqueada por otra US activa. |
| **N** | Negotiable | ✅ | Los AC fijan el comportamiento observable; la forma del endpoint/form queda al equipo. |
| **V** | Valuable | ✅ | Capturado en §2 — hallazgo directo de la prueba visual del dueño. |
| **E** | Estimable | ✅ | T-shirt S, alcance chico y bien acotado (1 migración + 1 endpoint + 1 form). |
| **S** | Small | ✅ | Completable en un ciclo corto. |
| **T** | Testable | ✅ | Los 7 AC son verificables sin ambigüedad. |

## 6. Dependencias

- **Bloqueada por**: US-014 (cuentas de cliente, ya Done) — necesita que `Customer`/`/mi-cuenta` existan.
- **Bloquea a**: ninguna conocida.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-024 | 3h | claude-code | Todo |
| FE | FE-US-024 | 4h | claude-code | Todo |
| QA | QA-US-024 | 2h | claude-code | Todo |

> BE: migración `Customer.avatar_url String? @db.VarChar(2048)` (nullable, sin default — el placeholder es puramente de presentación en el FE, no un valor almacenado) + `PATCH /v1/me` (name + avatar_url, valida contra `req.customer.id` de la sesión, nunca un id recibido — AC-7). FE: form en `AccountPanel.tsx` (o un componente hermano) reusando el patrón de validación de `ProductForm.tsx` para la URL; placeholder = iniciales del nombre sobre un color determinístico (sin librería nueva) cuando `avatar_url` es null. QA vive dentro de FE/BE (mismo criterio que US-014/US-017 — sin change `-qa` propio).

## 8. Diseño

- **Tiene Figma**: no.
- Hereda de `docs/product/design-system.md` — el form reusa los componentes `Field`/`Input`/`Button` ya usados en `LoginForm.tsx`/`ProductForm.tsx`. El placeholder de avatar (iniciales + color) es un patrón nuevo y chico: 1-2 letras del nombre sobre un círculo de color derivado determinísticamente del id del cliente (mismo color siempre para el mismo cliente, sin persistir nada nuevo).

## 9. NFRs específicos de esta US

- La validación de la URL de avatar es **de forma únicamente** (esquema http/https + longitud razonable) — no se hace un fetch server-side de la URL para verificar que responda o que sea una imagen real (evita SSRF: un fetch server-side a una URL arbitraria provista por el cliente es una superficie de ataque conocida — `security-standards.md`). La imagen simplemente no se ve si la URL no carga; no es un error del sistema.
- Sin NFR de volumetría/latencia distinto al baseline (un PATCH simple sobre una fila ya indexada por PK).

## 10. Notas / contexto adicional

- Precedente exacto de "URL pegada, no upload": `apps/web/src/features/products/ProductForm.tsx` (`image_url: z.string().url(...)`) y `apps/api/src/products/products.repository.ts` (`image_url` como columna simple). Este US replica ese patrón para el cliente en vez de inventar uno nuevo.
- El dueño confirmó explícitamente (2026-09-06) que quiere nombre + avatar juntos en esta US, con avatar por URL (no upload real) tras conocer el costo real de construir un pipeline de subida desde cero (no existe ningún cliente R2/S3 en el código pese a que `R2_*` aparece en `.env` — nunca se llegó a cablear).

---

## Definition of Ready (gate Triage → Ready)

- [x] §1 Historia escrita en formato Connextra
- [x] §2 Por qué importa explicado
- [x] §3 7 AC en Gherkin (4 happy/alternative + 3 negative-space)
- [x] §5 INVEST con todas las letras OK
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system + precedente de patrón exacto)
- [x] Dependencias chequeadas (US-014 Done, sin bloqueantes)

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
