# Orden de construcción (build order) — DSM E-commerce

> Recomputado el 2026-08-23 contra el estado real. **Entrega 2 (MVP) está construida**:
> catálogo + búsqueda IA + login + carrito. Lo que resta es el **núcleo transaccional** y su
> fan-out (gestión de órdenes, notificaciones, métricas), más deuda de cierre (QA + cloud).

## Dónde estamos

| Capa | US | Estado |
|---|---|---|
| Fundación (infra local + admin catálogo) | US-001 | ✅ Done (archivada) |
| Catálogo público (browse + ficha) | US-002, US-003 | ✅ code-complete (US-003 archivada) |
| **Búsqueda IA + enriquecimiento** | US-004, US-005 | ✅ code-complete (BE+FE) |
| Import masivo | US-006 | ✅ BE+FE (QA pendiente) |
| **Carrito** | US-007 | ✅ code-complete (3 disciplinas) |
| **Login / registro / sesión** | US-014 | ✅ BE+FE (QA 8/12) |
| Legales + WhatsApp | US-017, US-018 | ✅ code-complete |
| Infra cloud | US-019 | 🔨 2/15 (parkeada) |

## Qué falta (el trabajo real que resta)

**Núcleo transaccional (0% construido) — el critical path de acá en adelante:**
```
US-008 Checkout guest  →  US-009 Pago (MP + simulado)  →  US-010 Orden + webhook + stock
```
**Fan-out que US-010 destraba:**
```
US-011 Email (Resend) · US-012 Panel de órdenes del dueño · US-013 Cancelación/reembolso
US-015 Historial de compras · US-016 Métricas del dueño · US-021 Retención de datos
```
**Independientes / deuda:**
- US-019 Infra cloud (parkeada) · US-020 Borrado de cuenta (GDPR, US-014 listo) · US-022 (backlog)
- **Deuda de QA**: suites QA-owned de US-002 (2 diferidas), US-004, US-006 (0/16), US-014 (8/12).

## Camino crítico

```
[✅US-007] → US-008 → US-009 → US-010 → {US-011, US-012, US-013, US-016} 
```
El cuello de botella es la cadena **US-008→009→010**: es secuencial (checkout define el contrato
que consume el pago, el pago define lo que consume el webhook) y abre casi todo lo que queda.

## Tracks paralelos (por superficie — el backend es serial sobre el mismo árbol)

| Track | Superficie | Contenido |
|---|---|---|
| **A — Transaccional (BE)** | `apps/api` (serial) | US-008 → US-009 → US-010 |
| **B — Frontend transaccional** | `apps/web` | US-008 FE (tras su contrato) → US-012 FE → US-016 FE |
| **C — QA de cierre** | `qa/` (schema propio) | cerrar US-014, US-006, US-002 QA |
| **D — Infra / GDPR** | infra + `apps/api` | US-019 (cloud) · US-020 (borrado cuenta) |

> Regla: **una sola US de `apps/api` a la vez** (comparten `schema.prisma`, migraciones, DB).
> Track A y el BE de Track D (US-020) compiten por `apps/api` → coordinar o worktree.

## Desbloqueado AHORA (se puede arrancar ya)

- **US-008** (checkout BE) — US-007 ✅ → **el próximo del critical path**.
- **US-020** (borrado de cuenta) — US-014 ✅ (necesita enrich: está en Backlog).
- **US-019** (infra) — sin bloqueos, continuar.
- **Cierre de QA** — US-014 (8/12), US-006 (0/16), US-002 (marcar diferidas).

## Agrupación en cycles

- **Cycle actual (cerrado)** — Entrega 2 / MVP: US-001..007, 014, 017, 018 (catálogo + IA + login + carrito).
- **Cycle 3 — Compra**: US-008, US-009, US-010 (checkout → pago → orden).
- **Cycle 4 — Gestión**: US-011, US-012, US-013, US-016, US-015.
- **Cycle 5 — Cierre**: US-019 (cloud), US-020 (GDPR), US-021 (retención), deuda de QA.
