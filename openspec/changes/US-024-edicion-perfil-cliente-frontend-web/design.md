# Design — Edición de perfil del cliente (frontend-web)

## Context

`AccountPanel.tsx` (US-014) renderiza el nombre/email/fecha de alta del
cliente como texto estático — declarado honestamente como no-editable en su
momento. Esta US cierra esa brecha con el patrón mínimo que el dueño ya
aceptó para productos: una URL pegada, no un upload real
(`ProductForm.tsx`, `image_url: z.string().url(...)`).

La superficie `/v1/me` ya existe (US-020, `DELETE /v1/me`) con su rewrite
same-origin `/v1/me/:path*` en `next.config.*` — **method-agnostic**, así que
`PATCH /v1/me` cae bajo el mismo rewrite sin trabajo de topología nuevo. La
sesión de cliente entera es Client Component desde US-014 (`openspec/specs/
cuentas/requirements.md` R-15/N-9) — este change no introduce ninguna
excepción a esa regla.

**Bloqueo de ejecución real**: `apps/api/docs/api/openapi.yaml` en este
worktree todavía NO declara `patch` bajo `/me` ni `avatar_url` en `Customer`
— lo está construyendo `US-024-edicion-perfil-cliente-backend` en paralelo.
Fase 0 de `tasks.md` es el gate explícito: nada de Fase 1 en adelante puede
generar código contra un contrato que no existe todavía.

## Goals

- Editar nombre + avatar (URL) desde `/mi-cuenta`, con el nombre reflejado de
  inmediato en toda la UI que lee la sesión (no sólo en la propia pantalla).
- Reusar el patrón de validación de URL ya establecido (`ProductForm.tsx`),
  endurecido a sólo `http`/`https` (AC-5 lo exige explícitamente; `.url()`
  solo no alcanza — acepta cualquier esquema sintácticamente válido).
- Placeholder de avatar sin librería nueva: iniciales sobre un color
  determinístico por id de cliente.
- Cero validación server-side de que la URL de avatar "sea una imagen real"
  — decisión NFR explícita para no abrir una superficie SSRF (US §9,
  `security-standards.md` §6.5).

## Non-goals

- Upload de archivo real (US §4).
- Preview en vivo mientras se tipea la URL (OQ-FE-2, default: no).
- Un nuevo rewrite/topología — ya cubierto por `/v1/me/:path*` (US-020).
- Idempotency-Key en el `PATCH` — ver `## Decisión: sin Idempotency-Key`.

## Approach

### Component breakdown

```
AccountPanel.tsx (modificado)
├── <Avatar customer={customer} size="lg" />         ← nuevo, components/ui
├── <ProfileForm customer={customer} />              ← nuevo, features/account
│     internamente: <Field>/<Input>/<Button> (design-system, ya usados en
│     LoginForm/ProductForm) + banner de error + banner de éxito
├── dl: Email (sólo lectura, AC-6) + Cliente desde (sin cambios)
├── DeleteAccountSection (sin cambios, US-020)
└── botón "Cerrar sesión" (sin cambios)
```

`ProfileForm` es HERMANO del `dl` de sólo lectura, no dentro de él — mismo
criterio de composición que `DeleteAccountSection` (sección independiente,
no un campo más de la lista de datos). El email permanece en el `dl`
estático: no hay ningún control de edición para ese campo (AC-6 se cumple
por **ausencia**, mismo criterio que `design.md` de US-020 §D5 para el botón
de borrar).

### Precarga de `buyer.name` en `CheckoutForm` (AC-1, segunda mitad)

**Hallazgo (2026-09-06, confirmado con la disciplina backend)**: `orders.buyer_name`
sale SIEMPRE de `body.buyer.name` del `POST /v1/checkout` — el backend nunca
lo deriva de `Customer.name`. `CheckoutForm.tsx` hoy no importa `useSession`
en ningún lado: `defaultValues.buyer.name` es `''` fijo, para invitado y
logueado por igual. Sin tocar este componente, AC-1 quedaría medio cumplido
(se ve en pantalla, no en la próxima orden).

Patrón elegido: la opción `values` de `react-hook-form` (no `defaultValues`,
que sólo aplica una vez al montar) + `resetOptions: { keepDirtyValues: true }`
— disponible desde v7.20, el proyecto usa 7.54.2. Sincroniza `buyer.name` con
`customer.name` de la sesión CUANDO CAMBIA, pero **nunca pisa un campo que la
persona ya tocó** (`keepDirtyValues`) — necesario porque `useSession()`
resuelve asíncrono (`unknown` → `authenticating` → `authenticated`) y podría
resolver DESPUÉS de que alguien ya empezó a tipear.

```tsx
const { state } = useSession();
const customerName = state.kind === 'authenticated' ? state.customer.name : undefined;

const { register, ... } = useForm<CheckoutFormValues>({
  resolver: checkoutResolver,
  defaultValues: DEFAULT_VALUES,
  values: customerName
    ? { ...DEFAULT_VALUES, buyer: { ...DEFAULT_VALUES.buyer, name: customerName } }
    : undefined,
  resetOptions: { keepDirtyValues: true },
});
```

Sigue editable a propósito — la US no pide bloquear el campo, y un cliente
logueado puede legítimamente comprar para otra persona (retiro a nombre de
un tercero). Es un default, no un valor fijo. Invitado (`state.kind !==
'authenticated'`) → `values` es `undefined`, comportamiento IDÉNTICO al
actual (sin regresión).

**Costo de test**: `CheckoutForm.test.tsx`/`checkoutA11y.test.tsx`/
`CheckoutPage.test.tsx` montan hoy sin `<SessionProvider>` (el componente no
lo necesitaba). Con `useSession()` adentro, los tres archivos necesitan
envolver sus `render(...)` — mecánico, sin cambiar ninguna aserción
existente (con `SessionProvider` en su estado default `anonymous`, el
comportamiento observado es el mismo que hoy).

`Avatar` (`components/ui/Avatar.tsx`) es un componente **compartido**, sin
estado propio:

```ts
interface AvatarProps {
  name: string;
  customerId: string;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg'; // 32px / 48px / 96px
}
```

Renderiza `<img src={avatarUrl} onError={...} />` cuando `avatarUrl` está
presente; el `onError` conmuta un estado local `broken` que degrada al
círculo de iniciales — nunca el ícono roto nativo del navegador
(`frontend-resilience-patterns` skill, patrón #11). Cuando `avatarUrl` es
`null`/`undefined`/vacío, renderiza directamente el círculo de iniciales.

### Placeholder determinístico — algoritmo

`apps/web/src/lib/format/avatar.ts` (puro, sin React, mismo criterio que
`currency.ts`/`datetime.ts`):

```ts
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + second).toUpperCase();
}

/** Hash simple → hue 0-359. Mismo id => mismo color, siempre. */
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 65% 55%)`;
}
```

Sin librería nueva (US §8 lo exige), sin persistir nada — el color se
recalcula en cada render a partir del `id` ya presente en `Customer`.

### Estado — `SessionProvider.updateCustomer`

`SessionContextValue` gana un método:

```ts
updateCustomer: (patch: Partial<Customer>) => void;
```

Implementación: si `state.kind === 'authenticated'`, produce
`{ ...state, customer: { ...state.customer, ...patch } }`. Es **estado local
optimista sobre la respuesta ya confirmada del backend** (se llama DESPUÉS de
que `accountService.updateProfile()` resuelve con éxito, nunca antes) — no es
optimistic UI en el sentido de "mostrar antes de confirmar" (`frontend-
resilience-patterns` patrón #4 no aplica acá: no hay rollback porque no hay
nada que revertir, el dato ya viene confirmado).

Sin este método, AC-1 ("se refleja de inmediato en la pantalla") sólo se
cumpliría re-montando `SessionProvider` (recarga completa) o releyendo
`GET /auth/me` tras cada guardado — ambas opciones más caras y más lentas que
extender el estado que ya existe en memoria. `AccountMenu.tsx` (el nombre en
el header) se beneficia del mismo cambio sin tocarlo.

### Formulario — schema Zod

**Pattern replicado de `ProductForm.tsx` (línea 25)**:
```ts
image_url: z.string().url('URL inválida').optional().or(z.literal('')),
```

**Endurecido para este caso** (AC-5 exige rechazar un esquema distinto de
http/https; `.url()` sólo valida que la cadena sea una URL sintácticamente
válida — acepta `data:`, `javascript:`, `ftp:`, etc.):

```ts
const httpUrl = z
  .string()
  .url('URL inválida')
  .refine(
    (v) => {
      try {
        return ['http:', 'https:'].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    },
    { message: 'La URL debe empezar con http:// o https://' },
  );

const schema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido'),
  avatar_url: httpUrl.optional().or(z.literal('')),
});
```

**Semántica de "vaciar" distinta de `ProductForm`** — decisión explícita:
en `ProductForm`, `avatar_url: ''` se mapea a `undefined` en el submit
("no tocar el campo"). Acá NO: `avatar_url: ''` en el submit se mapea a
`null` explícito en el body (AC-3 — "borra la URL y guarda" → vuelve al
placeholder). El campo `name` es siempre requerido (AC-4), así que no existe
la ambigüedad "vacío = no tocar" que sí tiene `image_url` de producto.

```ts
const body = {
  name: values.name,
  avatar_url: values.avatar_url ? values.avatar_url : null,
};
```

### Mapeo de errores del backend

Mismo `FIELD_MAP` que `ProductForm.tsx` (por nombre de columna del 422):

```ts
const FIELD_MAP: Record<string, keyof FormValues> = {
  name: 'name',
  avatar_url: 'avatar_url',
};
```

Banner + `setError` por campo en `kind === 'validation'`; banner genérico en
`kind === 'network' | 'server'`; `copyRateLimited(retryAfterSeconds)` en
`kind === 'rateLimited'` (mismo helper que `LoginForm.tsx`/
`ResetRequestForm.tsx`, `authCopy.ts`).

### AC-7 desde el lado del frontend

El backend es la autoridad (`req.customer.id` de la sesión, nunca un
parámetro de la request — US §3 AC-7). La responsabilidad del frontend es
**no ofrecer la superficie**: `updateProfile(input: { name, avatar_url })`
nunca acepta ni envía un `id`/`customer_id`. `ProfileForm.test.tsx` incluye
un caso que captura el body real enviado y afirma que NO contiene esas
claves — verificación complementaria del lado del cliente, no un sustituto
de la garantía del backend.

## Decisión: sin Idempotency-Key

`api-standards.md` §10 marca `Idempotency-Key` como **recomendado** (no
mandatorio) para `PATCH`. `PATCH /v1/me` con este body es naturalmente
idempotente — repetir la misma request produce el mismo estado final (no
"incrementa" ni "agrega" nada) — y el precedente inmediato en esta misma
capacidad (`DELETE /v1/me`, US-020) tampoco lo usa, apoyándose sólo en CSRF.
Mismo criterio acá: sin key.

## Decisión: sin nuevo rewrite / topología

`PATCH /v1/me` cae bajo `/v1/me/:path*` (`next.config.*`, agregado en
US-020) — los rewrites de Next matchean por *path*, no por método HTTP. No
hay tarea de configuración nueva; sí una tarea de **verificación** (Fase 4,
E2E) que lo prueba contra la app construida, mismo criterio que
`account-deletion-topology.spec.ts` (que existe precisamente porque esa
topología faltó una vez y lo encontró QA en producción, no el propio change
de FE — no se repite ese patrón acá).

## Trade-offs

| Decisión | Alternativa considerada | Por qué se descartó |
|---|---|---|
| Preview del avatar sólo post-guardado | Preview en vivo mientras se tipea | Complejidad extra (debounce + estado adicional) sin AC que lo exija; el dato en vivo no está confirmado por el backend |
| Un solo formulario para nombre+avatar, un solo botón "Guardar" | Dos formularios/botones independientes | La US no distingue guardar nombre de guardar avatar; un solo PATCH con ambos campos es más simple y ya es el shape de la DTO asumida |
| `avatar_url` vacío → `null` explícito en el body | Igual que `ProductForm` (`undefined` = no tocar) | AC-3 exige que "borrar y guardar" remueva el avatar — `undefined` dejaría el valor anterior intacto, el comportamiento opuesto al pedido |
| Color determinístico con hash simple (sin librería) | `md5`/`crypto` u otra librería de color | US §8 exige explícitamente "sin librería nueva"; el hash simple es suficiente para el único requisito (mismo id → mismo color siempre) |

## Spec delta

Este change **consume** el contrato de `/v1/me` pero no lo posee: el delta
de contrato (`PATCH /me` + `avatar_url` en `Customer`) lo declara y aplica
`US-024-edicion-perfil-cliente-backend` en su propio `design.md`/archive. En
`openspec/specs/cuentas/` (CAP-6), este change únicamente agrega la sección
"Desde US-024 frontend-web" a `requirements.md`/`decisions.md` en su propio
`/archive-change` — sin tocar `contracts/openapi.yaml` (eso lo actualiza el
archive del backend).

## Test plan

Ver `tasks.md` Fase 3 (unit + componente + a11y) y Fase 4 (E2E). Resumen:

- Unit: `avatar.ts` (helpers puros, determinismo).
- Componente (RTL + MSW): `Avatar.tsx` (fallback `onError`), `ProfileForm.tsx`
  (las 5 AC positivas/negative-space + mapeo de errores 422/429/5xx + AC-7
  desde el body capturado), `AccountPanel.tsx`/`SessionProvider.tsx`
  (regresión de la composición existente + `updateCustomer`).
- A11y: `axe(container)` sobre `AccountPanel` con `ProfileForm` montado
  (`a11y.test.tsx`, extiende la suite ya existente).
- E2E (Playwright, app construida): `profile-edit-topology.spec.ts` — el
  `PATCH` sale por el rewrite same-origin con CSRF válido y refleja
  `response.status()`, mismo criterio que `account-deletion-topology.spec.ts`
  (nunca DOM para el estado HTTP, F59).

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| El operationId/shape real de `PATCH /v1/me` que publique 07 difiere del asumido (`Customer` plano) | Media | Baja (cambio mecánico) | Fase 0 T0.1 reconcilia contra el contrato real antes de escribir `accountService.updateProfile`; el `Verify` de T1.3 falla loud si el import no existe |
| Backend agrega `avatar_url` con longitud/constraint distinta a la esperada | Baja | Baja | La validación Zod del cliente es sólo UX; el 422 del servidor manda vía `FIELD_MAP`, ya cableado |
| `<img>` con URL maliciosa (`javascript:`) burla el filtro de esquema por un bug de regex | Baja | Media | El `refine` usa el parser `URL` nativo, no una regex hecha a mano (`security-standards.md` §6.6, evita ReDoS/parsing ad-hoc) |

## References

- Ticket: `docs/user-stories/US-024-edicion-perfil-cliente.md`
- Backend ticket consumido: `US-024-edicion-perfil-cliente-backend` (paralelo, sesión 07)
- Precedentes de código: `apps/web/src/features/products/ProductForm.tsx`,
  `apps/web/src/features/account/DeleteAccountSection.tsx`,
  `apps/web/src/features/account/SessionProvider.tsx`
- Capability viva: `openspec/specs/cuentas/` (CAP-6)
- Standards: ver `proposal.md` §"Standards consultados"
- Sin ADR nuevo (reusa patrones existentes)
