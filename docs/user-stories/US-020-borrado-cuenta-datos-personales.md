---
type: user-story
id: US-020
slug: borrado-cuenta-datos-personales
parent-prd: docs/product/prd.md
prd-capacity: 13
parent-e2e: docs/product/design-e2e.md
status: In Progress
priority: Medium
estimate-tshirt: M
story_points_traditional: 8
story_points_ai_assisted: 4
estimation_basis: "Disciplina dominante BE: endpoint transaccional multi-entidad (anonimización de la cuenta con placeholder único + revocación de sesiones y tokens de reset + desvinculación de carritos + reuso del anonimizador de órdenes de US-021 + guarda de órdenes en curso) sobre un esquema que ya existe, con control de concurrencia e idempotencia — Cohn 2005 §10, 8 SP. FE (flujo destructivo de dos pasos en un panel existente, Cohn 2005 §8, 5 SP) y QA (automatización de 15 AC, Cohn 2005 §12, 5 SP) quedan por debajo. Se toma el dominante × 0.45 (Peng 2023) = 3.6 → 4, mismo criterio que US-021."
language: es
created: 2026-08-18
updated: 2026-09-06
ready-at: 2026-09-06
in-progress-at: 2026-09-06
authored-by: Gabriel Suarez
disciplines: [BE, FE, QA]
linear-issue-id: null
figma-frames: []
---

# US-020: Borrado de cuenta y datos personales (derecho al olvido)

## 1. La historia (formato Connextra)

**Como** cliente registrado de DSM,
**quiero** borrar mi cuenta y mis datos personales por mí mismo, desde mi propia cuenta y sin
tener que pedírselo a nadie,
**para** ejercer el derecho que me da la Ley 25.326 y dejar de figurar en la base del comercio
cuando ya no quiero comprar ahí.

## 2. Por qué importa (Valuable)

El PRD §6 lo **compromete explícitamente**: «los datos del comprador (cuenta + contacto) se
conservan **hasta que el cliente solicite el borrado de su cuenta**». Esa promesa se publica
por escrito en la política de privacidad que US-017 pone online, y hoy **no tiene
implementación**: la columna `customers.deleted_at` existe desde US-014 y el login ya la
filtra, pero **ningún endpoint la escribe**. US-017 lo declara fuera de alcance y US-014 lo
difiere «a una US futura». Esta es esa US.

Es una obligación legal asumida ante el cliente (Ley 25.326 de protección de datos personales,
AR), no una mejora de experiencia: sin esto, el sitio promete por escrito algo que no puede
cumplir, y eso es incumplimiento con apariencia de cumplimiento. US-021 ya cerró la mitad
equivalente para las órdenes de compradores invitados; esta cierra la de las cuentas
registradas y completa la capacidad 13 del PRD.

## 3. Criterios de aceptación (Gherkin / Given-When-Then)

### AC-1: El cliente borra su cuenta desde su propia cuenta (happy path)
```gherkin
Given un cliente registrado con sesión iniciada y sin órdenes en curso
When entra a la sección de su cuenta, elige borrar su cuenta y confirma la advertencia de que la acción es definitiva
Then el borrado se ejecuta de inmediato, en el momento de confirmar
And la sesión queda cerrada y el cliente vuelve al sitio como visitante anónimo
And ve un mensaje que confirma que su cuenta y sus datos personales fueron borrados
```

### AC-2: Los datos personales de la cuenta dejan de existir (happy path)
```gherkin
Given una cuenta cuyo borrado se ejecutó
When se consulta el sistema por esa persona desde cualquier superficie —el sitio, el panel del dueño, un listado o una exportación—
Then su nombre, su email y su teléfono ya no aparecen en ninguna
And en su lugar figura una indicación de que los datos fueron suprimidos
And no queda en el sistema ninguna copia recuperable de esos tres datos
```

### AC-3: El historial comercial sobrevive anonimizado (happy path)
```gherkin
Given un cliente con órdenes ya entregadas o canceladas que borra su cuenta
When se ejecuta el borrado
Then los datos de comprador de esas órdenes quedan anonimizados igual que cuando se anonimiza una orden a pedido (US-021)
And cada una de esas órdenes conserva sus productos, cantidades, importes, estado y fechas
And ninguna orden ni ninguno de sus ítems se elimina
And consta que la anonimización fue a pedido de la persona y en qué momento
```

### AC-4: Un cliente con órdenes en curso no puede borrar la cuenta todavía (alternative path)
```gherkin
Given un cliente con al menos una orden sin pagar o pagada y sin entregar
When intenta borrar su cuenta
Then la solicitud se rechaza y no se modifica ningún dato
And se le explica que primero tiene que retirar esas órdenes o cancelarlas
And se le indica cuántas y cuáles son las órdenes que lo bloquean, con el mismo nivel de detalle que ya ve en su historial de compras y nada más
```

### AC-5: El email queda liberado y el re-registro empieza de cero (alternative path)
```gherkin
Given una persona que borró su cuenta
When se registra de nuevo con el mismo email
Then el registro se completa como si fuera la primera vez
And la cuenta nueva no muestra el historial de compras, el carrito ni ningún dato de la cuenta anterior
And nada en el sitio revela que esa persona ya había tenido cuenta
```

### AC-6: Borrar dos cuentas distintas nunca colisiona (alternative path — caso borde)
```gherkin
Given dos clientes registrados distintos
When ambos borran su cuenta, uno después del otro o los dos a la vez
Then los dos borrados se completan sin error
And ninguno de los dos falla porque el otro ya había borrado la suya
```

### AC-7: El cliente se arrepiente antes de confirmar (alternative path)
```gherkin
Given un cliente que abrió el flujo de borrado y está en el paso de confirmación
When cancela, cierra la confirmación o abandona la página sin confirmar
Then no se borra ni se modifica ningún dato
And su sesión sigue abierta y su cuenta sigue funcionando igual que antes
```

### AC-8: Cuenta sin órdenes, o con órdenes ya anonimizadas (alternative path)
```gherkin
Given un cliente que nunca compró, o cuyas órdenes ya habían sido anonimizadas por el plazo de retención de 12 meses
When borra su cuenta
Then el borrado se completa igual, sin error
And las órdenes que ya estaban anonimizadas no se vuelven a anonimizar ni cambian de marca de auditoría
```

### AC-9: La verificación de órdenes en curso se hace al ejecutar, no al mostrar (negative space — carrera)
```gherkin
Given un cliente que abrió el flujo de borrado cuando no tenía órdenes en curso
When entre que vio la pantalla y confirma le entra o le queda activa una orden sin pagar o sin entregar
Then el borrado NO se ejecuta y se lo rechaza con la misma explicación que en AC-4
And, en el caso inverso —tenía una orden activa que se entregó o se canceló mientras miraba la pantalla—, el borrado sí procede al confirmar sin obligarlo a recargar
```

### AC-10: La cuenta borrada no vuelve a entrar por ninguna puerta (negative space)
```gherkin
Given una cuenta borrada
When se intenta iniciar sesión con sus credenciales anteriores, usar una sesión que había quedado abierta en otro dispositivo, o abrir un enlace de recuperación de contraseña que estaba pendiente
Then ninguna de las tres vías da acceso
And la respuesta es indistinguible de la de un email que nunca existió — no revela que la cuenta existió ni que fue borrada
```

### AC-11: No hay vuelta atrás ni ventana de gracia (negative space)
```gherkin
Given una cuenta borrada
When el cliente o el dueño intentan recuperarla, deshacer la acción o consultar una solicitud de borrado pendiente
Then no existe ninguna vía en el sistema para hacerlo
And no existe ningún estado intermedio de "borrado pendiente" ni ningún proceso diferido que ejecute el borrado más tarde
```

### AC-12: El panel de métricas del dueño no se mueve (negative space)
```gherkin
Given un conjunto de órdenes de un cliente que borra su cuenta
When el dueño consulta las métricas del negocio (US-016) antes y después del borrado
Then los totales, las cantidades, los productos vendidos y las fechas son idénticos
And ninguna venta desaparece del panel por efecto del borrado
```

### AC-13: Nadie borra la cuenta de otro (negative space)
```gherkin
Given el borrado de cuenta
When lo intenta alguien que no es el titular con su sesión iniciada —una persona sin sesión, otro cliente registrado, o el dueño desde el panel—
Then la operación se rechaza
And no se modifica ninguna cuenta ni ninguna orden
```

### AC-14: La PII borrada no sobrevive en la observabilidad (negative space)
```gherkin
Given el borrado de una cuenta
When se revisan los registros, eventos y respuestas que produjo la operación
Then ninguno contiene el nombre, el email ni el teléfono que se acaban de borrar, ni siquiera transformados
And el registro operativo permite saber que hubo un borrado y cuándo, sin identificar a la persona
```

### AC-15: Confirmar dos veces produce un solo efecto (negative space)
```gherkin
Given un cliente que confirma el borrado dos veces —doble clic, o la misma sesión abierta en dos pestañas—
When ambas confirmaciones llegan
Then el borrado se aplica una sola vez
And la segunda no produce error ni un segundo registro de auditoría ni una segunda anonimización de las mismas órdenes
```

## 4. Out of scope explícito

- **Registro, login y sesión** — US-014 (esta US consume la cuenta y la sesión que aquella
  crea).
- **Anonimización de órdenes de compradores invitados** — US-021, ya entregada. Esta US
  **reusa** ese mecanismo para las órdenes del cliente registrado; no construye otro.
- **Redacción del texto legal** de la política de privacidad — US-017. Esta US ejecuta lo que
  ese texto promete; el texto en sí no se toca acá.
- **Borrado iniciado por el dueño desde el panel.** Decisión de producto: el flujo es
  autoservicio (§10, decisión 4). Si más adelante hace falta que el dueño ejecute el pedido de
  alguien que perdió el acceso a su cuenta, es otra US.
- **Exportación / portabilidad de datos personales** (derecho de acceso, otro derecho de la
  Ley 25.326) — fuera de v1 salvo que el asesor legal lo exija. Ya declarado como diferido con
  dueño en la capacidad 13 (`retencion-datos-personales`, D-4).
- **Purga programada de tokens vencidos** — diferida en US-014 a operaciones (necesita
  BullMQ / Redis, ADR-0004). Esta US revoca los tokens de la cuenta que se borra, en el acto;
  no construye el barrido periódico.
- **Cambio del plazo de retención de 12 meses de las órdenes** — es de US-021.

## 5. INVEST self-check

| Letra | Criterio | Cumple? | Notas |
|---|---|---|---|
| **I** | Independent | ✅ | Depende de US-014 (la cuenta y la sesión), US-015 (el vínculo `orden → cliente`) y US-021 (el mecanismo de anonimización de órdenes). Las tres tienen su backend ya mergeado a `main`: US-021 está `Done`, y de US-014/US-015 lo pendiente es QA/FE, no lo que esta US consume. Ninguna es un bloqueo real de arranque — ver §6. |
| **N** | Negotiable | ✅ | El copy del flujo destructivo, la forma exacta del placeholder de anonimización y la superficie donde vive la acción son negociables. Lo que NO es negociable son las 5 decisiones de producto ya cerradas en §10 — los AC las fijan como comportamiento observable. |
| **V** | Valuable | ✅ | Cierra la promesa escrita del PRD §6 y la exposición legal de la Ley 25.326 que US-017 publica. Es la condición que faltaba para que la capacidad 13 esté completa (US-021 cubrió las órdenes de invitados; esta cubre las cuentas). |
| **E** | Estimable | ✅ | 8 SP tradicional / 4 SP AI-asistido. El esquema ya existe (`deleted_at`, `onDelete` de las cuatro relaciones) y el anonimizador de órdenes también — el trabajo es orquestación transaccional, no diseño nuevo. |
| **S** | Small | ✅ | M / 8 SP. Acotada a cuentas registradas: sin exportación, sin borrado por el dueño, sin barrido periódico. |
| **T** | Testable | ✅ | 15 AC en Gherkin, todos observables desde el sitio, el panel del dueño o los datos. Ninguno afirma una intención. |

## 6. Dependencias

- **Bloqueada por**:
  - **US-014** (registro / login / sesión) — `In Progress`. Es la US que crea `customers`,
    `deleted_at` y el mecanismo de revocación de sesiones que AC-10 exige. Su **backend y su
    frontend ya están archivados y mergeados**; lo que la mantiene abierta es una pregunta de
    QA sin cerrar sobre el NFR de latencia de login, que **no** condiciona a esta US. La dependencia sigue
    siendo real como orden de construcción, pero no impide arrancar hoy.
  - **US-015** (historial de compras) — `In Progress`, backend mergeado (PR #70). Es la US que
    escribe `orders.customer_id`, es decir, la que hace que «las órdenes de este cliente» sea
    un conjunto computable. Sin ella, AC-3 y AC-4 no tienen sobre qué operar. Su backend ya
    está en `main`, así que tampoco bloquea el arranque.
  - **US-021** (retención y anonimización de órdenes) — `Done`. Aporta el mecanismo de
    anonimización que AC-3 reusa y la marca de auditoría que AC-3 y AC-8 verifican.
- **Relacionada**: US-016 (las métricas que AC-12 protege), US-017 (la política de privacidad
  que promete esto), US-007 (el carrito que queda desvinculado y expira por su propia ventana),
  US-012 (el panel del dueño, donde AC-2 debe verse sin la PII).
- **No bloquea a** ninguna US, pero **sí es condición de salida a producción**: junto con
  US-021 completan la capacidad 13, que es `Must` y es lo que hace publicable la política de
  privacidad de US-017.

## 7. Tasks asociadas (gruesas, una por disciplina afectada)

| Disciplina | Task id | Estimado (h) | Owner | Estado |
|---|---|---|---|---|
| BE | BE-US-020 | 12-16h | TBD | Todo |
| FE | FE-US-020 | 6-8h | TBD | Todo |
| QA | QA-US-020 | 6-8h | TBD | Todo |

- **BE**: operación de borrado autoservicio, en una sola transacción — guarda de órdenes en
  curso evaluada al ejecutar (AC-4, AC-9); sobrescritura de nombre, email y teléfono de la
  cuenta por valores no reversibles y **únicos por fila** (el email tiene restricción de
  unicidad — AC-6); sello de la fecha de borrado; revocación de todas las sesiones y de los
  enlaces de recuperación pendientes (AC-10); desvinculación de los carritos; anonimización de
  las órdenes históricas del cliente reusando el mecanismo de US-021 (AC-3); idempotencia ante
  confirmación doble (AC-15); autorización sólo para el titular (AC-13); observabilidad sin
  PII (AC-14).
- **FE**: sección «borrar mi cuenta» dentro de `/mi-cuenta`, con confirmación destructiva de
  dos pasos que explique qué se borra y qué se conserva; manejo del rechazo por órdenes en
  curso con la explicación de AC-4; cierre de sesión y retorno al sitio como visitante tras el
  borrado (AC-1); estado de cancelación sin efectos (AC-7).
- **QA**: automatización de los 15 AC — con énfasis en el caso borde de colisión del
  placeholder único (AC-6), la carrera de la orden que cambia de estado entre la pantalla y la
  confirmación (AC-9), la comparación de agregados de US-016 antes/después (AC-12) y las tres
  puertas de acceso de AC-10.

> Las tasks code-generating (BE/FE) abren su openspec change en
> `openspec/changes/US-020-borrado-cuenta-datos-personales-{discipline}/`. La task QA vive en
> `tasks/US-020/qa-deliverable.md` salvo que se resuelva embeberla en el change de backend
> (Modo A), como ya se hizo en US-021.

## 8. Diseño

- **Tiene Figma**: no. Hereda de `docs/product/design-system.md` (`Approved`).
- La acción vive en el panel de cuenta del cliente (`/mi-cuenta`), en una sección separada del
  resto de las acciones de la cuenta, visualmente marcada como zona destructiva.
- **Componentes**: Button variante `destructive` (§7.1) para el disparador y para la
  confirmación final; Modal/Dialog (§7.5) para el segundo paso — el propio catálogo ya declara
  «confirmación destructive, dos pasos» como uno de sus usos canónicos, con focus trap, cierre
  por `Escape` y foco que vuelve al disparador; Toast (§7.6) `success` para el resultado y
  `error` sticky para el rechazo por órdenes en curso.
- **Tono** §10.2 («práctico y confiable»): el texto tiene que decir sin eufemismos que el
  borrado es inmediato y no se puede deshacer, y qué sobrevive (el historial de compras
  anonimizado, sin sus datos).
- **Accesibilidad** §11: el botón de confirmación NO recibe el foco por defecto al abrir el
  diálogo (evita el borrado por `Enter` inercial); todo el flujo navegable por teclado; el
  resultado se anuncia por región `aria-live`.

## 9. NFRs específicos de esta US

Hereda los del PRD §4 y los del E2E §17. Agrega, específicos de esta US:

- **Plazo de ejecución — inmediato y síncrono**: el borrado se completa dentro de la misma
  operación en la que el cliente confirma. No hay proceso diferido, cola ni ventana de gracia,
  con lo que cualquier plazo de respuesta que exija la normativa queda cubierto por
  construcción. Presupuesto: **p95 < 500 ms** para una cuenta con hasta 50 órdenes —hereda el
  presupuesto de escritura del E2E §17— `[propuesto — confirma Arquitecto]`; si aparece un
  cliente con un volumen mayor, se revisa el presupuesto antes que el diseño.
- **Irreversibilidad**: tras el borrado, el sistema no conserva ninguna copia recuperable del
  nombre, el email ni el teléfono de esa cuenta — ni en la fila, ni en otra tabla, ni en logs
  (AC-2, AC-11). El único rastro admisible del dato original es su ausencia.
- **Atomicidad**: todos los efectos —anonimización de la cuenta, revocación de sesiones y
  tokens, desvinculación de carritos, anonimización de las órdenes históricas— ocurren o no
  ocurre ninguno. Un borrado a medias deja a una persona con sus datos borrados y su sesión
  viva, que es peor que no haber borrado.
- **Idempotencia**: dos confirmaciones de la misma intención producen un solo efecto y ningún
  error (AC-15), con el mismo criterio que US-021 ya aplicó a las órdenes.
- **Unicidad del valor de anonimización**: el email de la cuenta tiene restricción de
  unicidad, así que el valor con el que se lo sobrescribe tiene que ser distinto en cada fila
  borrada (AC-6) y no debe ser una dirección de correo alcanzable. Es la diferencia concreta
  con US-021, donde el valor es fijo porque las órdenes no tienen esa restricción.
- **Observabilidad sin PII**: la operación deja registro de que hubo un borrado, cuándo y
  cuántas órdenes anonimizó — nunca el nombre, el email ni el teléfono, ni siquiera hasheados
  (AC-14). Es la misma regla que ya rige en la capacidad 13 para las órdenes.
- **Autorización**: sólo el titular con sesión iniciada, sobre su propia cuenta (AC-13).
- **Accesibilidad del flujo destructivo**: WCAG 2.1 AA sobre los dos pasos —foco gestionado,
  operable sólo con teclado, sin foco por defecto en el botón destructivo, resultado anunciado
  por lector de pantalla, targets ≥ 44×44 px en mobile (design-system §11).

## 10. Notas / contexto adicional

**Origen**: hueco de cobertura detectado el 2026-08-18 al planificar el backend de US-014. El
PRD §6 compromete el borrado, `customers.deleted_at` se crea en US-014 (DER del E2E §8) pero
**ningún endpoint la escribe**, y ni US-014 ni US-017 lo cubrían. La columna existe, la promesa
existe, el trabajo no estaba asignado.

### Decisiones de producto — todas cerradas

Las cinco preguntas que este esqueleto dejó abiertas fueron resueltas por el PO. No se
reabren; los AC de §3 son su traducción a comportamiento observable.

1. **[Resolved — anonimizar la fila de la cuenta, no borrarla]** El borrado sobrescribe la PII
   de la fila (nombre, email, teléfono) y sella la fecha de borrado; la fila sobrevive. Es el
   mismo patrón conceptual que US-021 ya aplicó a las órdenes. El identificador interno del
   cliente se mantiene en sus órdenes, así el vínculo del historial no se rompe y las métricas
   de US-016 siguen cuadrando (AC-12).
2. **[Resolved — el email queda liberado]** La persona puede volver a registrarse con el mismo
   correo, y esa cuenta nueva empieza de cero, sin ver nada de la anterior (AC-5). El email
   real tiene que desaparecer del sistema, no quedar bloqueado: guardarlo para impedir el
   re-registro sería seguir conservando un dato personal después de haber prometido borrarlo.
3. **[Resolved — inmediato e irreversible]** Al confirmar se ejecuta, en el acto. Sin ventana
   de gracia, sin solicitud pendiente, sin job diferido (AC-1, AC-11). Es la opción más limpia
   legalmente: no queda un período en el que los datos siguen vivos «por las dudas».
4. **[Resolved — autoservicio]** Lo dispara el propio cliente desde su cuenta, con la sesión
   que le da US-014. No es una acción del dueño desde el panel (AC-13). Contrasta a propósito
   con US-021, donde el pedido del comprador **invitado** sí lo ejecuta el dueño: aquel no
   tiene cuenta ni forma de probar su identidad, éste sí.
5. **[Resolved — las órdenes en curso bloquean el borrado]** Si el cliente tiene una orden sin
   pagar (`pending_payment`) o pagada y sin entregar (`new`, `preparing`, `ready`), la
   solicitud se rechaza y se le explica que primero tiene que retirarlas o cancelarlas (AC-4).
   Las órdenes `delivered` y `cancelled` son terminales y no bloquean nada. **Fundamento**: la
   supresión no es absoluta mientras hay un contrato en ejecución. Anonimizar el nombre, el
   email y el teléfono de un pedido pagado y sin retirar dejaría al dueño sin forma de
   entregarlo, volviendo la orden imposible de completar — se perjudica al propio cliente que
   pidió el borrado. Se prioriza cerrar el contrato en curso y después permitir el borrado.
   La verificación corre **al ejecutar**, no sólo al mostrar la pantalla (AC-9): entre que el
   cliente ve el formulario y confirma, una orden puede entrar, entregarse o cancelarse.

### Corrección de una premisa falsa del esqueleto

La versión anterior de esta sección afirmaba que «borrar la fila rompe la integridad
referencial con las órdenes». **Es falso** y no se propaga: las cuatro relaciones que cuelgan
de `customers` en el esquema ya están declaradas —`orders` y `carts` con `ON DELETE SET NULL`,
`refresh_tokens` y `password_reset_tokens` con `ON DELETE CASCADE`—, así que un borrado físico
tampoco habría roto nada. La razón real para anonimizar en vez de borrar es otra y es la de la
decisión 1: **conservar el vínculo** entre las órdenes y su cliente, que es lo que hace que el
historial y las métricas de US-016 sigan cuadrando después.

Del mismo modo, las dos promesas del PRD §6 **no están en tensión**, como sugería el esqueleto:
«datos del comprador (cuenta + contacto) hasta que el cliente solicite el borrado» y «historial
de órdenes hasta 12 meses» conviven perfectamente con la anonimización de US-021 — el importe,
el estado y la fecha de la orden sobreviven (métricas y retención quedan cubiertas) mientras la
PII del comprador se borra. No hay que elegir cuál gana.

### Consecuencia operativa de no hacer borrado físico

Como el borrado es lógico, **ninguno de los `ON DELETE` del esquema se dispara**. El flujo
tiene que ocuparse explícitamente de cada relación, y por eso hay un AC para cada una:

| Relación | `onDelete` declarado | Qué hace este flujo | AC |
|---|---|---|---|
| `refresh_tokens` | `Cascade` (no se dispara) | Revoca todas las sesiones de la cuenta, en todos los dispositivos. | AC-1, AC-10 |
| `password_reset_tokens` | `Cascade` (no se dispara) | Invalida los enlaces de recuperación pendientes — si no, un link vivo en la casilla de la persona sería una puerta abierta a una cuenta que ya no debería existir. | AC-10 |
| `carts` | `SetNull` (no se dispara) | Desvincula el carrito de la cuenta. No se borra su contenido: pasa a ser un carrito anónimo y expira por su propia ventana (US-007). El comentario del esquema ya fijaba esta intención («borrar una cuenta anonimiza el carrito, no lo borra»). | AC-2 |
| `orders` | `SetNull` (no se dispara) | El vínculo se mantiene a propósito (decisión 1) y se anonimiza la PII de comprador de cada orden reusando el mecanismo de US-021. | AC-3, AC-12 |

### Diferencia concreta con US-021 que hay que respetar

US-021 anonimiza órdenes con un valor **fijo** (`datos-suprimidos@anonimizado.dsm.invalid`), y
puede hacerlo porque `orders.buyer_email` no tiene restricción de unicidad.
`customers.email` **sí la tiene**. Combinado con la decisión 2 (el email real debe desaparecer)
esto obliga a que el valor de anonimización sea **único por fila**: si dos personas borran su
cuenta, la segunda no puede fallar por chocar contra el placeholder de la primera. Es el caso
borde que AC-6 fija y que QA tiene que probar explícitamente.

### Asesoría legal

El esqueleto pedía consultar a asesoría legal antes de cerrar los puntos 1 y 3. El PO los cerró
con las decisiones de arriba: **inmediato** (3) es la postura más conservadora posible frente a
cualquier plazo de respuesta, y **anonimizar** (1) es la única forma de cumplir el borrado sin
incumplir la retención de 12 meses que el mismo PRD §6 fija. La decisión 5 acota el derecho
sólo mientras hay un contrato en ejecución, que es el estándar del propio régimen. Si la
asesoría legal del cliente objeta alguno de los tres puntos, entra como CR contra esta US — no
como bloqueo del arranque.

---

## Definition of Ready (gate Backlog → Ready)

- [x] §1 Historia escrita en formato Connextra (rol, capacidad y valor concretos)
- [x] §2 Por qué importa explicado y conectado al PRD §6 + capacidad 13
- [x] §3 Al menos 1 AC en Gherkin (15 AC: 3 happy + 5 alternative + 7 negative-space)
- [x] §4 Out of scope explícito (7 ítems)
- [x] §5 INVEST con todas las letras OK
- [x] §6 Dependencias chequeadas (US-014 / US-015 `In Progress` con backend mergeado, US-021 `Done`)
- [x] §7 Tasks por disciplina identificadas con estimado en horas
- [x] §8 Diseño resuelto (design-system referenciado; sin Figma)
- [x] §9 NFRs específicos enumerados y cuantificados (sin TBD)
- [x] §10 Sin preguntas abiertas: las 5 decisiones de producto están resueltas
- [x] Story points cargados (8 tradicional / 4 AI-asistido) con base citada

## Definition of Done (gate QA → Done)

- [ ] Todas las tasks de la US en estado Done
- [ ] Regression suite del producto verde en staging
- [ ] AC manuales verificados por QA
- [ ] PO firma acceptance
