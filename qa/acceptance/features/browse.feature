# language: es
@browse
Característica: Navegación por categorías del storefront (US-002)
  Como cliente del storefront
  quiero recorrer los rubros y subrubros
  para encontrar productos sin conocer su nombre exacto

  Antecedentes:
    Dado un árbol de categorías sembrado con productos en todos sus estados

  @happy @critical-path
  Escenario: TC-210 — Un rubro muestra sus subrubros y agrega los productos de sus hijos
    Cuando un visitante abre el rubro por su slug
    Entonces ve el subrubro entre las opciones de navegación
    Y ve productos publicados en la grilla
    # La agregación es la regla D-1 del backend: un rubro suma lo de sus hijos.
    # Sin este assert, un rubro que sólo listara lo propio pasaría igual.
    Y entre ellos está un producto que cuelga del subrubro

  @happy @critical-path
  Escenario: TC-211 — Un subrubro lista sólo lo propio y deja volver al rubro padre
    Cuando un visitante abre el subrubro por su slug
    Entonces ve productos publicados en la grilla
    # Lo inverso de TC-210: el hijo NO hereda hacia arriba. Si listara también
    # lo del padre, la agregación estaría rota en la otra dirección y nadie lo
    # notaría mirando sólo el rubro.
    Y no ve el producto que cuelga directamente del rubro padre
    Y puede volver al rubro padre desde la navegación

  @happy
  Escenario: TC-212 — La grilla muestra los datos de compra y está paginada
    Cuando un visitante abre el subrubro por su slug
    Entonces cada producto de la grilla muestra su nombre y su precio en pesos
    Y la grilla ofrece una segunda página
    Cuando el visitante avanza a la segunda página
    Entonces ve productos distintos a los de la primera

  @corner
  Escenario: TC-213 — Un producto sin stock se ve pero no se puede comprar
    Cuando un visitante abre el subrubro por su slug
    Entonces ve el producto sin stock con su indicador de falta de stock
    Y la grilla no ofrece ninguna acción de compra

  @corner
  Escenario: TC-214 — Una categoría sin productos ofrece salida en vez de un vacío mudo
    Cuando un visitante abre la categoría vacía
    Entonces ve un mensaje de que todavía no hay productos
    Y puede navegar hacia otros rubros desde esa misma página

  @cross-feature @critical-path
  Escenario: TC-215 — Desde la grilla se llega a la ficha del mismo producto
    Cuando un visitante abre el subrubro por su slug
    Y hace clic en el primer producto de la grilla
    # Único test que detectaría una divergencia de identificador entre la grilla
    # y la ficha: si la grilla enlazara por `sku` y la ficha resolviera por
    # `slug`, acá daría 404 (ver OQ-QA-2 / decisión D-1).
    Entonces llega a la ficha de ese producto
    Y la ficha muestra el mismo nombre y el mismo precio que la grilla

  @cross-feature
  Escenario: TC-216 — Publicar en el panel hace aparecer el producto en la categoría
    Dado que un visitante ya vio la categoría sin el producto nuevo
    Cuando el dueño publica ese producto desde el panel
    Entonces el producto aparece en la categoría sin esperar el vencimiento de la caché
