# US-001 — Charters de testing exploratorio (manual)

> `execution_mode: manual` — no se automatizan: son sesiones time-boxed guiadas por
> heurísticas, complementarias a la suite automatizada (qa-plan §exploratorio).

## TC-031 — Máquina de transición de estado del producto

- **Misión**: descubrir transiciones de estado inesperadas o inconsistencias entre
  lo que la UI muestra y lo que el backend permite (draft → published → archived).
- **Áreas**: acciones publicar/archivar/despublicar; producto ya archivado;
  publicar dos veces (doble submit); editar mientras se publica; carreras.
- **Riesgos**: cambio optimista falso (UI dice published, backend rechazó);
  reactivar un archivado por una ruta no prevista; estado inconsistente tras 422.
- **Heurísticas**: CRUD-Z (crear/leer/actualizar/borrar + estados), "goldilocks"
  (muy rápido / doble click), interrupción (navegar durante la mutación).
- **Justificación manual**: explora el espacio de estados más allá de las
  transiciones canónicas ya cubiertas por `products.state.spec.ts` (dev L1) y la
  aceptación (L3).

## TC-032 — Autenticación y sesión admin (seam ADR-0009)

- **Misión**: sondear los bordes del seam de auth: expiración, token manipulado,
  rol incorrecto, sesión en múltiples pestañas, logout.
- **Áreas**: `/acceso` (login real), guard del route group, interceptor de token,
  expiración del JWT (1h), token con `role` distinto, `signOut`.
- **Riesgos**: panel accesible con token expirado (guard sólo UX); fuga del token;
  bypass del guard por navegación directa; el backend NO revalida (defensa en
  profundidad server-side es la autoridad — confirmar 401/403 reales).
- **Heurísticas**: "follow the data" (dónde vive el token), boundary (exp ±1s),
  tampering (editar el claim `role` y reenviar → debe dar 403).
- **Justificación manual**: cubre escenarios de sesión/tiempo difíciles de
  automatizar de forma determinista; el barrido RBAC estático ya está en Newman (L3).

---

# US-003 — Ficha pública de producto

## TC-340 — SEO real y preview al compartir

- **Misión**: verificar cómo interpretan la ficha los consumidores externos —
  buscadores y previsualizadores de redes— más allá de que el HTML sea correcto.
- **Áreas**: JSON-LD contra el validador de datos estructurados de Google; Rich
  Results Test; preview de WhatsApp / Facebook / X con el `og:image` real;
  canonical; `title` truncado en resultados; comportamiento con imagen faltante
  (el placeholder no tiene URL pública para el `og:image`).
- **Riesgos**: JSON-LD sintácticamente válido pero rechazado por reglas de
  negocio de Google (falta `priceValidUntil`, `availability` mal mapeada);
  preview sin imagen o con imagen rota en el canal que el dueño más usa
  (WhatsApp, PRD §12); canonical apuntando a `localhost` en un deploy mal
  configurado.
- **Heurísticas**: "follow the consumer" (validar con la herramienta del
  consumidor real, no con la propia); comparar una ficha con imagen contra una
  con placeholder; probar el enlace pegado en un chat real.
- **Justificación manual**: depende de herramientas externas y de juicio sobre
  cómo *se ve* el resultado. Automatizarlo daría **falsa confianza** sobre el
  objetivo de negocio de la US — que a DSM se la encuentre y el enlace se vea
  bien al compartirlo. TC-303 ya cubre que el JSON-LD exista y sea coherente;
  esto cubre que **sirva**.

## TC-341 — Caché de la ficha bajo un CDN real

- **Misión**: sondear el comportamiento de caché de la ficha con un CDN delante,
  que es la topología de producción (Cloudflare → Railway, E2E §despliegue).
- **Áreas**: interacción entre el `Cache-Control` del backend (`max-age=60` sólo
  en 2xx), la Data Cache de Next (1 h) y la caché de borde del CDN;
  `stale-while-revalidate`; qué pasa con un 404 o un 429 (no deben quedar
  cacheados — hallazgo M1 de US-003); purga tras editar el precio en el panel.
- **Riesgos**: el CDN sirve un precio viejo aunque `revalidateProduct` haya
  corrido (la invalidación es del origen, no del borde) — AC-9 se cumple en
  local y se incumple en producción; un 404 cacheado en el borde hace
  desaparecer un producto recién publicado.
- **Heurísticas**: variar el orden (leer → editar → leer desde otra región /
  otro navegador); inspeccionar `age` y `cf-cache-status`; forzar un miss.
- **Justificación manual**: el comportamiento real depende de la configuración
  del CDN, que **no existe hasta US-019** (provisión de la nube). Un test contra
  el origen no lo reproduce, y montar un CDN de mentira mediría otra cosa.
  Se ejecuta como parte del pre-uat, cuando exista el entorno prod-shaped.

---

## TC-240 — Indexación real del árbol de categorías (US-002 AC-4)

- **Misión**: averiguar si un buscador real llega a **todas** las categorías y
  fichas publicadas, y si no indexa ninguna que no deba existir.
- **Áreas**: `sitemap.xml` (cobertura y ausencia de URLs muertas) · `robots.txt`
  · canonical de las páginas 2+ · `rel=prev/next` · JSON-LD `BreadcrumbList` ·
  Search Console (cobertura, exclusiones, "página alternativa con etiqueta
  canónica adecuada").
- **Riesgos**: el canonical auto-referencial de la página N está bien formado
  pero Google decide indexar sólo la 1, y la mayoría del catálogo queda fuera;
  el sitemap anuncia una categoría que devuelve 404 real y el dominio pierde
  reputación de rastreo; una categoría vacía se indexa como página de aterrizaje
  sin contenido.
- **Heurísticas**: comparar el conteo del sitemap contra el de categorías
  publicadas en la API; pedir cada URL del sitemap y verificar 200; buscar
  `site:` sobre el dominio; forzar un re-rastreo y observar qué versión toma.
- **Justificación manual** (`execution_mode: manual`): el criterio de éxito lo
  decide **un tercero** —el crawler—, en su propia ventana de tiempo. Un test
  automatizado sólo puede verificar lo que el sitio *ofrece*, no lo que Google
  *hace*, y eso ya está cubierto por TC-203/TC-204. Además exige un dominio
  público verificado, que **no existe hasta US-019**. Se ejecuta en el pre-uat.

## TC-241 — Coherencia del árbol con datos reales del dueño (US-002 AC-1/AC-2)

- **Misión**: averiguar si la navegación se sostiene cuando el árbol lo arma el
  dueño con nombres, profundidades y volúmenes reales, en vez del fixture
  prolijo que usan los tests.
- **Áreas**: nombres largos, con acentos, con `&`, `/` o emoji · dos categorías
  cuyo nombre deriva al mismo slug · rubro con un solo subrubro y sin productos
  propios · subrubro con más productos que el padre · renombrar una categoría ya
  indexada · mover un producto entre categorías.
- **Riesgos**: la barra de rubros desborda o se vuelve inusable con más de ~15
  categorías (hoy en desarrollo ya se ven decenas acumuladas y el recorrido por
  teclado se hace largo — observado al escribir TC-221); un renombre cambia el
  slug y deja la URL vieja en 404 sin redirección; la agregación rubro→subrubro
  confunde al dueño, que ve un producto "en dos lugares".
- **Heurísticas**: llevar el árbol al extremo por un eje a la vez (ancho,
  profundidad, longitud de nombre); recorrer con teclado y con lector de
  pantalla; mirar la misma categoría como dueño y como visitante.
- **Justificación manual** (`execution_mode: manual`): el criterio es de
  **usabilidad y juicio** —"¿se entiende dónde estoy?"— y no un assert. Un test
  puede verificar que el link exista; no que el árbol resultante sea navegable
  para una persona. Se ejecuta con el dueño antes del UAT.
