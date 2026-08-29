---
type: user-story
id: US-020
slug: borrado-cuenta-datos-personales
parent-prd: docs/product/prd.md
prd-capacity: 13
parent-e2e: docs/product/design-e2e.md
status: Backlog
priority: Medium
estimate-tshirt: M
language: es
created: 2026-08-18
updated: 2026-08-18
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-020: Borrado de cuenta y datos personales (derecho al olvido)

## 1. La historia (formato Connextra)

**Como** cliente registrado,
**quiero** poder solicitar el borrado de mi cuenta y de mis datos personales,
**para** ejercer el derecho que me da la Ley 25.326 y dejar de figurar en la base del comercio cuando ya no quiero comprar ahí.

## 2. Por qué importa (Valuable)

El PRD §6 lo **compromete explícitamente**: "los datos del comprador se conservan **hasta que el cliente solicite el borrado de su cuenta**". Hoy esa promesa no tiene implementación ni US que la cubra — US-017 la declara fuera de alcance y US-014 la difiere a "una US futura". Es una obligación legal (Ley 25.326 de protección de datos personales, AR) asumida ante el cliente y publicada en la política de privacidad que US-017 pone online: sin esta US, el sitio promete por escrito algo que no puede cumplir.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

> **Esqueleto** — los AC se completan en `/enrich-user-story`, que corre el gate de DoR.
> Los de abajo son el punto de partida, no la lista final.

### AC-1: El cliente solicita el borrado de su cuenta
```gherkin
Given un cliente registrado con sesión iniciada
When solicita el borrado de su cuenta y lo confirma
Then el sistema procesa la solicitud
And sus sesiones activas quedan invalidadas
```

### AC-2: Los datos personales dejan de ser accesibles
```gherkin
Given una cuenta cuyo borrado fue procesado
When alguien consulta el sistema por ese cliente
Then sus datos personales ya no son recuperables desde ninguna superficie
And el email queda liberado o bloqueado según la política que se defina
```

### AC-3: El historial de órdenes sobrevive de forma anonimizada
```gherkin
Given un cliente con órdenes previas que pide el borrado
When se procesa la solicitud
Then las órdenes se conservan sin datos que identifiquen a la persona
And el panel de métricas del dueño (US-016) sigue cuadrando
```

## 4. Out of scope explícito

- **Registro, login y sesión** — US-014 (esta US consume la cuenta que aquella crea).
- **Redacción del texto legal** de la política de privacidad — US-017.
- **Purga programada de tokens vencidos** — diferida en US-014 a operaciones (necesita BullMQ / Redis, ADR-0004).
- **Exportación de datos personales** (portabilidad) — fuera de v1 salvo que el asesor legal lo exija.

## 5. INVEST self-check

> Pendiente: lo completa `/enrich-user-story` antes de mover a `Ready`.

## 6. Dependencias

- **Bloqueada por**: US-014 (no hay cuenta que borrar hasta que exista el registro). US-014 está `In Progress`.
- **Relacionada**: US-017 (la política de privacidad publica esta promesa), US-015 (historial de compras), US-016 (panel de métricas — el anonimizado no debe romper los agregados).

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-020 | TBD | TBD | Todo |
| FE | FE-US-020 | TBD | TBD | Todo |
| QA | QA-US-020 | TBD | TBD | Todo |

> Estimados a cargar en `/enrich-user-story`.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md`. Es un flujo destructivo, así que necesita confirmación en dos pasos y un mensaje claro sobre qué se borra y qué se conserva.

## 9. NFRs específicos de esta US

- Pendiente de enriquecimiento. A definir al menos: plazo máximo entre la solicitud y el borrado efectivo, y si el borrado es inmediato o diferido con ventana de arrepentimiento.

## 10. Notas / contexto adicional

**Origen**: hueco de cobertura detectado el 2026-08-18 al planificar el backend de US-014. El PRD §6 compromete el borrado, `customers.deleted_at` se crea en US-014 (DER del E2E §8) pero **ningún endpoint la escribe**, y ni US-014 ni US-017 lo cubren. La columna existe, la promesa existe, el trabajo no estaba asignado.

**Decisiones de producto que el enriquecimiento debe resolver** (ninguna es técnica):

1. **Borrado real o anonimización.** Borrar la fila rompe la integridad referencial con las órdenes; anonimizar conserva el historial de compras que el PRD §6 quiere retener 12 meses. Son promesas en tensión y hay que elegir cuál gana.
2. **Qué pasa con el email.** Si se libera, esa persona puede volver a registrarse con el mismo mail; si se bloquea, se sigue guardando un dato personal después de haber prometido borrarlo.
3. **Inmediato o con ventana de arrepentimiento.** Un borrado irreversible al instante es más limpio legalmente; una ventana de días evita el arrepentimiento pero mantiene los datos vivos mientras corre.
4. **Autoservicio o pedido al dueño.** Un endpoint que el cliente dispara solo, o una solicitud que el dueño ejecuta desde el panel. Lo segundo es más barato de construir y más lento de cumplir.

**Consultar con asesoría legal** antes de cerrar el punto 1 y el 3: la Ley 25.326 tiene plazos de respuesta y la interacción con la retención de 12 meses del PRD §6 no es obvia.
