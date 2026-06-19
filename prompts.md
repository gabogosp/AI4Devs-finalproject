## 1. Descripción general del producto

**Prompt 1 — Generación del PRD**
```
# Rol y expertise
Actúa como Product Discovery Partner senior con más de 10 años llevando comercios físicos (retail, oficios)
a su primer canal digital en Latinoamérica. Conoces el comportamiento del comprador argentino, la
conversión en e-commerce de baja reputación, y cómo traducir una necesidad de negocio difusa en un PRD
accionable que un arquitecto pueda tomar sin huecos.

# Objetivo
Producir el PRD interno —completo y listo para arquitectura— del primer e-commerce de DSM Refrigeración y
Ferretería.

# Contexto de negocio (úsalo; no lo repitas literal)
- DSM es una ferretería real, un único local en la esquina de Av. Córdoba y Av. Pueyrredón (CABA), que HOY
  no tiene ninguna presencia digital: no vende online, no aparece en buscadores, depende del tráfico a pie.
- Diferenciador buscado: una búsqueda que entienda al cliente aunque no sepa el nombre técnico. Ejemplo
  guía: el cliente escribe "algo para colgar un cuadro en una pared dura" y el sistema debe interpretar
  "fijación a mampostería" → tarugos + tornillos para hormigón + mecha de widia.
- Mercado mobile-first; comprador particular o gremio (plomero, electricista, refrigerista); español
  rioplatense; presupuesto de ferretería (hosting económico, sin hyperscalers).
- El dueño (Pedro) es el operador: carga el catálogo y gestiona las órdenes.

# Proceso (razona en este orden ANTES de escribir)
1. Infiere personas y Jobs-To-Be-Done a partir del contexto; no inventes datos demográficos.
2. Define el flujo end-to-end que crea valor COMPLETO (descubrir → comprar → el dueño prepara y entrega) y
   conviértelo en la columna vertebral del alcance.
3. Recién entonces deriva las capacidades y priorízalas con MoSCoW contra ese flujo.
4. Por cada flujo con estados, recorre CADA transición preguntándote "¿quién se entera?" y "¿cómo se
   revierte?" — eso alimenta las tablas de notificaciones y de reversa.

# Estructura de salida obligatoria (no omitas ninguna sección)
1. Visión: una frase; por qué existe (problema + costo de no resolverlo); a quién sirve (personas + JTBD);
   métricas de éxito con baseline y target a fecha, marcando las proyecciones sin baseline.
2. Alcance (MoSCoW): tabla [#, capacidad, outcome de usuario, prioridad]. Sección aparte "fuera del MVP"
   tratada como ROADMAP (no descarte): por cada ítem, motivo de diferimiento y camino de incorporación.
3. Flujos principales (con diagramas). Por cada flujo con estados: (a) tabla de notificaciones
   [transición → quién se entera → canal]; (b) camino de reversa [cancelación/reembolso/reposición de
   stock]; (c) casos borde.
4. NFRs cuantificados (nada de "rápido"/"escalable"/"seguro" sin número): disponibilidad, p95 por
   operación, SEO/LCP, concurrencia objetivo, volumen de datos, RPO/RTO, idempotencia, accesibilidad.
5. Integraciones externas: [proveedor, propósito, titular de la cuenta, modo test/sandbox/demo para probar
   sin transacción real].
6. Datos a alto nivel: entidades, datos sensibles, retención. Si hay PII → requisitos legales
   (privacidad/términos/consentimiento) + normativa local aplicable (Argentina: Ley 25.326).
7. Roles y permisos; plan de releases por incrementos demostrables; suposiciones; riesgos; preguntas
   abiertas [pregunta, a quién, ¿bloquea la aprobación?].

# Ejemplo de la barra de calidad esperada (una fila de capacidad)
| 2 | Búsqueda semántica con IA | El cliente describe su necesidad en lenguaje natural y recibe productos
relevantes sin conocer el nombre técnico. Es el diferenciador. | Must |

# Auto-validación antes de entregar
- ¿TODA capacidad Must traza a un paso del flujo end-to-end prioritario? Si no, reconsidera la prioridad.
- ¿Hay algún NFR sin número? Cuantifícalo.
- ¿Algún flujo con estados quedó sin su tabla de notificaciones o sin su camino de reversa? Complétalo.
- ¿Marcaste como [default — confirmar] cada decisión de alcance/arquitectura que tomaste por tu cuenta?

# Anti-patrones a evitar
- Meter todo en el MVP (usa Should/Could/roadmap con criterio).
- "Fuera de alcance" como descarte permanente (es roadmap a producción).
- Cerrar el loop solo del lado del comprador (incluye la operación del dueño y el post-venta).
- Inventar métricas con baseline cuando no hay datos previos (márcalas como proyección).

# Formato
Markdown, profundidad media-alta. Tablas para capacidades (MoSCoW), NFRs e integraciones; diagramas Mermaid
para los flujos. El documento debe quedar listo para que el arquitecto derive la solución técnica.
```
> **Refinamiento humano:** tras generar, se auditó la completitud del loop comercial y se incorporó a mano: el reencuadre de "no incluido" como roadmap, un medio de pago simulado para test/demo, el backoffice del dueño como capacidad de primera clase, el aviso de "listo para retirar", las páginas legales + consentimiento (Ley 25.326) y la cancelación/reembolso con reposición de stock (Prompt 2).

**Prompt 2 — Auditoría de completitud del loop (refinamiento)**
```
# Rol
Actúa como Product Manager senior obsesionado con la completitud operativa: un producto no termina cuando
el cliente paga, sino cuando el negocio puede cumplir, cobrar y resolver lo que sale mal.

# Objetivo
Auditar un PRD ya redactado y completar el loop comercial que quedó a medias (termina en "pago + stock",
sin el lado operativo del dueño ni el post-venta).

# Método de auditoría (recorre el ciclo de vida de una venta y marca cada eslabón faltante)
descubre → compra → PAGA → [¿el dueño se entera?] → [¿prepara?] → [¿avisa al cliente?] → [¿entrega?] →
[¿qué pasa si el cliente cancela / no hay stock / quiere reembolso?] → [¿qué exige la ley por los datos
que guardo?]

# Correcciones a aplicar (mínimo)
1. Reencuadra lo "no incluido" como ROADMAP a producción (parte del producto, diferido), no como descarte.
2. Agrega un medio de pago SIMULADO para demos al cliente y para el test end-to-end (sin transacción real).
3. Eleva el backoffice del dueño a capacidad de primera clase (no un panel secundario).
4. Suma las piezas que hacen REAL la transacción: aviso al cliente cuando la orden está lista para retirar;
   páginas legales + consentimiento por recolección de PII; cancelación/reembolso con reintegro de stock; y
   un canal de contacto (el dominante en el mercado local).

# Restricciones
- No reduzcas el alcance existente; solo cierra los huecos.
- Mantén la coherencia con las capacidades y flujos ya definidos (numeración, prioridades, trazas).

# Formato de salida
Las ediciones concretas al PRD (capacidades nuevas y secciones afectadas), en el mismo estilo y nivel de
detalle del documento.
```

**Prompt 3 — Sistema de diseño (sin Figma)**
```
# Rol y expertise
Actúa como Design System Lead con experiencia en e-commerce mobile-first y en accesibilidad. El proyecto no
tiene Figma: este documento ES la fuente de verdad visual y de interacción para que el equipo construya UI
sin mockups por pantalla.

# Objetivo
Generar el design-system baseline de un e-commerce de ferretería cuyo diferenciador es una búsqueda por
lenguaje natural, usable y confiable desde el primer día.

# Contexto
- Tienda nueva, sin reputación digital; el comprador argentino está acostumbrado a la reputación de los
  marketplaces y desconfía de un sitio desconocido que le pide datos y dinero.
- Idioma español rioplatense; accesibilidad objetivo WCAG 2.1 AA; mercado mobile-first.

# Proceso (razona antes de producir)
1. Fija la dirección visual a partir del rubro (ferretería/retail de oficios): funcional sobre decorativo.
2. Define los tokens y, para CADA combinación de color en uso, calcula el ratio de contraste y verifícalo
   contra WCAG AA; si una combinación falla, corrígela (no la documentes como válida).
3. Diseña mobile-first: por cada componente clave, describe primero su comportamiento en teléfono.
4. Identifica el componente diferenciador (la búsqueda IA) y dale tratamiento de primera clase.

# Entregables
1. Dirección visual y referencias (qué emular / qué evitar).
2. Tokens: color (con ratio de contraste verificado por combinación), tipografía, spacing, radius, sombras,
   z-index/layering y motion.
3. Breakpoints y estrategia mobile-first, con patrones mobile por componente (nav, buscador, CTA sticky,
   tablas que colapsan a cards).
4. Catálogo de componentes core con anatomía + variantes + estados + accesibilidad + firma de props.
5. Sección DEDICADA al componente diferenciador (búsqueda IA): barra, sugerencias, página de resultados con
   interpretación visible de la consulta, estado de baja confianza y fallback a categorías. Y otra sección
   de señales de confianza para una tienda sin reputación (pago seguro, local físico verificable, retiro
   sin riesgo, canal humano).
6. Brand assets (favicon, imagen Open Graph 1200×630, estándar de imágenes de producto con aspect ratio fijo).
7. Voz y tono con copy real, incluyendo estados de error, vacío y carga.
8. Contrato de tokens (CSS variables + capa de alias semánticos) que habilite dark-mode sin reescribir
   componentes.

# Ejemplo de la barra de calidad (microcopy del diferenciador)
Placeholder del buscador: "Describí lo que buscás: ej. 'algo para colgar un cuadro en pared dura'".
Búsqueda sin resultados: "No encontramos productos para eso. Probá navegar por categoría 👇".

# Auto-validación
- ¿Cada token de color en uso tiene su ratio verificado? ¿Algún texto a tamaño body queda bajo 4.5:1?
- ¿Cada componente clave tiene su comportamiento mobile descrito?
- ¿El diferenciador tiene su propia sección, no un bullet dentro de "Input"?

# Anti-patrones
- Breakpoints implícitos / diseño desktop-first.
- El diferenciador tratado como un input genérico.
- Color como único portador de información (estado de orden/stock deben tener texto + ícono además de color).

# Formato
Markdown con tablas de tokens y especificación por componente; copy real en español rioplatense.
```
> **Refinamiento humano:** dos auditorías posteriores (UI/UX y arquitectura frontend) agregaron a mano el responsive/mobile-first, el componente estrella de búsqueda con su página de resultados, el patrón de checkout, el contrato de tokens (CSS vars + alias) y las señales de confianza.

---

## 2. Arquitectura del Sistema

### **2.1. Diagrama de arquitectura:**

**Prompt 1 — Solución end-to-end**
```
# Rol y expertise
Actúa como arquitecto de software senior especializado en sistemas transaccionales con integraciones de
pago y búsqueda semántica, con criterio de costo (presupuesto acotado) y de operabilidad (equipo chico).

# Objetivo
Diseñar la solución end-to-end (el "cómo") a partir de un PRD y un design-system aprobados: exhaustiva,
cuantificada y lista para implementar.

# Contexto / stack objetivo
- Monolito modular en NestJS + Next.js SSR + PostgreSQL con pgvector + Redis/BullMQ + proveedor de pago
  hosted; hosting económico single-region; equipo chico.

# Proceso (razona antes de diseñar)
1. Mapea cada capacidad del PRD §2.1 a un módulo y a un flujo; un hueco silencioso es un error.
2. Para el stock (única fuente de verdad), razona la concurrencia y la entrega no confiable de webhooks
   ANTES de elegir el modelo de decremento.
3. Para la búsqueda IA, separa el camino feliz (kNN) del degradado (IA caída → full-text) y del vacío
   (fallback a categorías).
4. Identifica las decisiones load-bearing y, en vez de asumirlas, PREGUNTA (ver guardrails).

# Entregables (sin huecos)
- C4 niveles 1 a 3 (contexto → contenedores → componentes), en diagramas.
- Modelo de datos (DER) con claves, tipos y restricciones.
- Diagramas de secuencia de los flujos críticos: búsqueda semántica (con fallback y degradación), checkout
  + webhook de pago idempotente, import asíncrono + enriquecimiento IA + embeddings, fulfillment, y
  cancelación/reembolso.
- Máquina de estados (FSM) de la orden, contemplando el estado de pre-confirmación de pago.
- Análisis de seguridad STRIDE por superficie crítica, con mitigaciones concretas.
- NFRs traducidos a infraestructura (números heredados del PRD).
- Plan de observabilidad y runbook de operatividad: tareas del operador de negocio + runbooks de
  incidentes (webhook caído, IA caída, cola atascada, restore, rotación de secretos, deploy/rollback).
- Estrategia de testing en capas (unit / integración / contrato / end-to-end / performance / calidad IA).
- La lista de decisiones que requieren ADR.

# Guardrails (críticos)
- Antes de ASUMIR cualquier decisión load-bearing —proveedor de IA, estrategia de auth, modelo de
  decremento de stock, infraestructura de trabajo asíncrono— PREGUNTA, no infieras.
- Cuantifica todo NFR (sin adjetivos sin número).
- Si el diseño introduce un job de fondo (reconciliación, limpieza, compensación), debe quedar explícito,
  no implícito.

# Auto-validación
- ¿Las 12 capacidades del PRD trazan a un módulo/flujo? ¿Alguna quedó sin cubrir?
- ¿El decremento de stock es correcto bajo dos compradores concurrentes por la última unidad?
- ¿El webhook es idempotente ante reenvío y resiste un payload falso?
- ¿Qué pasa si el pago se aprueba pero ya no hay stock? (debe haber un camino definido)

# Formato
Markdown con diagramas Mermaid (C4, DER, secuencias, FSM, despliegue, data-flow) y tablas (decisiones,
STRIDE, NFRs, testing).
```
> **Refinamiento humano:** cada decisión load-bearing se validó por trade-off antes de confirmarla; la auditoría agregó el estado `pending_payment`, el camino "pago aprobado pero sin stock → auto-reembolso", la elección de ORM (Prisma + `$queryRaw` para pgvector), el JWT en cookie httpOnly + refresh, y un apartado de operatividad. Se verificó que no arrastrara defaults ajenos al proyecto (single-region, no multi-cloud).

**Prompt 2 — Decisiones arquitectónicas (ADRs)**
```
# Rol
Actúa como arquitecto senior documentando decisiones para que un sucesor entienda no solo QUÉ se decidió,
sino POR QUÉ y QUÉ haría falta para cambiarlo.

# Objetivo
Formalizar cada decisión arquitectónica load-bearing del diseño como un ADR en formato MADR, con un índice
de decisiones consolidado.

# Estructura por ADR (MADR)
- Contexto (el problema y las fuerzas en juego).
- Decisión (qué se adopta, en una afirmación clara).
- Consecuencias: positivas / negativas / neutras (sé honesto con las negativas).
- Alternativas consideradas, cada una con "qué nos haría cambiar de opinión".
- Notas de implementación y criterios de validación (cómo sabremos que fue buena decisión).

# Restricciones de coherencia
- Cada ADR debe ser coherente con el diseño end-to-end (no contradecirlo). Si lo contradice, el error está
  en uno de los dos: detente y resuélvelo.
- Captura los matices de seguridad y consistencia: auth con token en cookie httpOnly + refresh rotado;
  idempotencia + auto-reembolso en el decremento de stock; justificación de la desviación de plataforma y
  de observabilidad.

# Auto-validación
- ¿Cada ADR enuncia al menos una consecuencia negativa real (no cosmética)?
- ¿Cada alternativa rechazada dice qué la reabriría?
- ¿Algún ADR contradice una secuencia o NFR del E2E?

# Formato
Un archivo MADR por decisión + un índice consolidado de decisiones.
```
> **Refinamiento humano:** se verificó que los ADRs no contradijeran el E2E (el caso "pago aprobado sin stock" debía decir "reembolsado", no "no cobrado") y se genérizaron las referencias para el entregable.

### **2.2. Descripción de componentes principales:**
Producido por el mismo prompt del E2E (§2.1), nivel C4 de componentes (módulos del monolito + apps web/worker).
> **Refinamiento humano:** se confirmó el corte por dominio (catalog, search, cart, checkout, payments, orders, stock, auth, import, metrics, notifications) y el aislamiento del stock para soportar MercadoLibre downstream a futuro.

### **2.3. Descripción de alto nivel del proyecto y estructura de ficheros**
```
# Rol
Actúa como arquitecto full-stack que valora un solo lenguaje de punta a punta y contratos tipados compartidos.

# Objetivo
Proponer la estructura de un monorepo para el proyecto, con su justificación y el patrón que sigue.

# Tarea
Define un monorepo (pnpm workspaces) con: apps web (Next.js SSR), api (NestJS) y worker (BullMQ), más
packages para el cliente de base de datos (Prisma), los tipos/contratos compartidos front↔back y el
design-system. Justifica cada carpeta y explica qué problema resuelve esa separación (tipos compartidos,
toolchain único, paridad local↔prod).

# Formato de salida
Árbol de directorios + una línea de propósito por carpeta principal.
```

### **2.4. Infraestructura y despliegue**
Derivado del prompt del E2E (§2.1), sección de despliegue.
> **Refinamiento humano:** se fijó explícitamente la plataforma económica (compute + Postgres gestionado + storage S3-compatible) en vez del default de infraestructura, y la observabilidad gestionada en vez de operar un stack propio.

### **2.5. Seguridad**
Derivado del prompt del E2E (§2.1), análisis STRIDE por superficie.
> **Refinamiento humano:** se reforzó la auth (token en cookie `httpOnly`+`secure`+`SameSite` + refresh rotado + rate-limit/lockout, nunca en localStorage) y la verificación de firma + re-consulta del webhook a su proveedor antes de tocar el stock.

### **2.6. Tests**
Derivado del prompt del E2E (§2.1), estrategia de testing en capas.
> **Refinamiento humano:** se priorizó el medio de pago simulado como pieza load-bearing del test end-to-end (ejercer el loop sin transacción real) y la batería de relevancia de la búsqueda IA como KPI verificable (≥ 70% en top-5).

---

## 3. Modelo de Datos

```
# Rol y expertise
Actúa como data architect senior con criterio sobre integridad transaccional, dinero y datos vectoriales.

# Objetivo
Formalizar el modelo de datos del e-commerce en un DER detallado a partir del diseño end-to-end.

# Decisiones de modelado que DEBES respetar (y por qué)
- Precios en CENTAVOS (enteros), nunca float: evita errores de redondeo en dinero.
- Embeddings de producto en una columna vectorial dedicada, con su índice de similitud (HNSW) y la versión
  del modelo de embedding: permite re-embeddear si cambia el proveedor sin perder la trazabilidad.
- Idempotencia del pago: clave ÚNICA del evento de pago (el id del proveedor), para que un webhook
  reenviado no aplique el efecto dos veces.
- Estado inicial de pre-confirmación de pago en la orden: la cola del dueño solo debe mostrar órdenes
  pagadas; las abandonadas no la contaminan.
- Snapshot del precio unitario en los ítems de orden: un cambio de precio futuro no altera ventas pasadas.
- Soft-delete para los datos personales sujetos a borrado a pedido del usuario (cumplimiento legal).
- Stock con CHECK (>= 0) como red de seguridad a nivel base.

# Tarea
Produce un DER (Mermaid `erDiagram`) con entidades, atributos con tipo, claves primarias y foráneas,
relaciones y cardinalidad, y restricciones (unique, not null, check). Acompaña con una descripción breve
por entidad.

# Auto-validación
- ¿Cada monto es entero en centavos? ¿Algún precio quedó como decimal?
- ¿La orden tiene su estado de pre-confirmación y los ítems su snapshot de precio?
- ¿La sintaxis Mermaid es válida y renderiza (claves combinadas como `PK, FK`, sin tokens inválidos)?

# Formato
Diagrama Mermaid (erDiagram) + descripción por entidad (atributos clave, claves, relaciones, restricciones).
```
> **Refinamiento humano:** se verificaron precios en centavos, `model_version` en embeddings, `idempotency_key` en pagos, el estado `pending_payment`, un placeholder para facturación fiscal futura, y se corrigió la sintaxis del diagrama (`PK, FK`) para que renderizara.

---

## 4. Especificación de la API

```
# Rol
Actúa como arquitecto de API / backend senior que diseña contratos REST claros y seguros.

# Objetivo
Especificar en OpenAPI 3.1 los tres endpoints más representativos del loop, a partir de los límites de
componentes y los flujos del diseño end-to-end.

# Tarea
1. Define convenciones transversales: autenticación (cookie httpOnly para sesión; firma para el webhook),
   envelope de error uniforme, idempotencia y rate-limit, y formato de montos (centavos).
2. Especifica los 3 endpoints —búsqueda semántica, creación de orden/checkout y webhook de pago— con
   `components/schemas`, `securitySchemes`, y ejemplos de request/response realistas.
3. Modela explícitamente los caminos NO felices: búsqueda sin resultados (con fallback a categorías) y
   webhook con firma inválida (rechazo, sin tocar stock).

# Restricciones
- Máximo 3 endpoints (los más representativos del flujo).
- Ejemplos coherentes con el modelo de datos (montos en centavos, ids con el formato del DER).

# Auto-validación
- ¿El webhook documenta la verificación de firma y la idempotencia?
- ¿La búsqueda documenta el caso de fallback (no solo el feliz)?
- ¿El YAML es OpenAPI 3.1 válido (parsea)?

# Formato
Bloque OpenAPI 3.1 en YAML + un párrafo de convenciones transversales.
```
> **Nota:** los contratos OpenAPI detallados por endpoint se completan en la planificación de tickets de backend (Entrega 2) y se validan con contract-testing.

---

## 5. Historias de Usuario

**Prompt 1 — Descomposición en User Stories**
```
# Rol
Actúa como Product Owner / analista de negocio que descompone un backlog sin perder cobertura ni trazabilidad.

# Objetivo
Descomponer el PRD y su arquitectura en la lista COMPLETA de User Stories que cubren todas las capacidades,
trazables y con sus dependencias.

# Proceso
1. Una US por outcome de usuario (no por pantalla ni por tabla).
2. Para cada US registra: capacidad de origen, dependencias (bloquea / bloqueada por) y prioridad.
3. Valida que TODA capacidad del PRD quede cubierta por al menos una US.
4. Barre la arquitectura por flujos de fondo/asíncronos y de reversa (reconciliación, jobs de limpieza,
   compensaciones tipo auto-reembolso) y asegúrate de que cada uno tenga su US dedicada o quede como
   criterio de la US dueña del recurso.

# Guardrails
- Si una capacidad queda huérfana (sin US), DETENTE y avisa; no la asignes en silencio (una capacidad sin
  US cascada a "no se implementa").
- No hay cobertura parcial aceptable: cada capacidad del PRD debe trazar a una US.

# Auto-validación
- ¿Cuántas capacidades hay en el PRD y cuántas quedaron cubiertas? (deben coincidir)
- ¿El grafo de dependencias tiene ciclos? (no debe)
- ¿Los jobs de fondo del E2E (reconciliación, limpieza) tienen dónde vivir?

# Formato
Un esqueleto de archivo por US (historia + capacidad de origen + dependencias) + un índice de estado.
```

**Prompt 2 — Enriquecimiento a "Ready"**
```
# Rol
Actúa como Product Owner / autor de historias senior que escribe criterios de aceptación a prueba de QA.

# Objetivo
Enriquecer cada User Story a estado "Ready", con calidad de producto y testabilidad real.

# Tarea — por cada historia
- Criterios de aceptación en Gherkin (Given/When/Then) que cubran: happy path + caminos alternativos +
  negative-space/casos borde + seguridad. No solo el camino feliz.
- Checklist INVEST con justificación por letra.
- NFRs específicos de la historia.
- Tareas gruesas por disciplina con estimación (tradicional y asistida por IA).
- Gates de Definition of Ready y Definition of Done.

# Restricciones
- Cada comportamiento de fondo o de reversa que la arquitectura introduce y que toca el recurso de la
  historia debe tener su criterio de aceptación (la rama no-feliz se resuelve según la arquitectura, no se
  deja vaga).

# Ejemplo de la barra de calidad (un AC negative-space del núcleo transaccional)
AC: Webhook duplicado no decrementa dos veces
  Given un pago ya procesado (mismo identificador de pago)
  When llega un webhook duplicado o reenviado para ese pago
  Then la orden no se vuelve a confirmar ni el stock se decrementa otra vez (idempotente)

# Auto-validación
- ¿Cada historia tiene al menos un AC de negative-space, no solo happy path?
- ¿Las tareas cubren todas las disciplinas que la historia toca?
- ¿Los AC son observables/verificables por QA (sin ambigüedad)?

# Formato
La historia completa con todas sus secciones, en el formato canónico del proyecto.
```
> **Refinamiento humano:** se auditaron las 18 historias; en la del núcleo transaccional se agregaron a mano los criterios de reconciliación de webhooks, limpieza de órdenes abandonadas y auto-reembolso ante falta de stock (estaban en la arquitectura pero no habían aterrizado como criterios verificables).

---

## 6. Tickets de Trabajo

```
# Rol
Actúa como tech lead que prepara tickets accionables para que un dev los tome sin volver a preguntar.

# Objetivo
Redactar tres tickets representativos (uno de backend, uno de frontend, uno de base de datos) a partir de
las historias "Ready" y la arquitectura, con todo el detalle para desarrollarlos de inicio a fin.

# Tarea — por cada ticket
- Contexto (por qué importa) y enfoque técnico (la estrategia, no solo el qué).
- Breakdown de tareas paso a paso.
- Criterios de aceptación, casos borde, riesgos y dependencias.
- Definición de hecho (tests verdes, condiciones de cierre) y estimación.

# Auto-validación
- ¿El ticket de backend explica idempotencia y concurrencia (no solo "implementar webhook")?
- ¿El de frontend define los estados (loading/empty/error) y el desacople por contrato (mock)?
- ¿El de base de datos cubre migración up/down reproducible y verificación de índices?

# Formato
Un bloque por ticket, con sus secciones; suficiente detalle para tomarlo y completarlo sin ambigüedad.
```
> **Nota:** la planificación de implementación detallada por disciplina se materializa en la Entrega 2.

---

## 7. Pull Requests

```
# Rol
Actúa como autor de un Pull Request que escribe descripciones que un reviewer agradece.

# Objetivo
Redactar la descripción de un Pull Request, clara, revisable y trazable.

# Tarea
Describe: qué cambia y por qué; el impacto (riesgo, áreas afectadas); cómo se probó (qué tests, qué se
verificó manualmente); y la referencia a la historia/ticket correspondiente.

# Formato de salida
Descripción de PR en markdown, lista para pegar.
```
> **Nota:** se documentarán aquí las 3 PRs principales una vez exista el código (Entrega 2 en adelante).
