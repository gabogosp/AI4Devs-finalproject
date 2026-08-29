# language: es
@ficha-publica
Característica: Ficha pública de producto (US-003)
  Como cliente del storefront
  quiero ver la ficha de un producto publicado
  para decidir si me sirve y avanzar con la compra

  Antecedentes:
    Dado un catálogo sembrado con productos en todos sus estados

  @happy @critical-path
  Escenario: H-1 — La ficha de un producto publicado muestra sus datos
    Cuando un visitante abre la ficha del producto publicado
    Entonces ve su nombre y su precio en pesos
    Y ve el indicador de disponibilidad "En stock"

  # US-007 ya conectó el carrito (T3.4): el CTA se presenta y habilita el
  # flujo de compra, tal como pide el AC-3 de esta US ("esa acción habilita
  # el flujo de compra, detallado en US-007").
  @happy
  Escenario: H-3 — Un producto con stock presenta la acción de compra
    Cuando un visitante abre la ficha del producto publicado
    Entonces la ficha presenta la acción de agregar al carrito
    Y esa acción habilita el flujo de compra

  @corner
  Escenario: C-1 — Sin stock: visible pero no comprable
    Cuando un visitante abre la ficha del producto sin stock
    Entonces ve el indicador "Sin stock"
    Y no se ofrece la acción de agregar al carrito
    Y se ofrece el canal de contacto para consultar

  @corner
  Escenario: C-2 — Producto sin imagen usa un placeholder accesible
    Cuando un visitante abre la ficha del producto sin imagen
    Entonces la imagen mostrada tiene un texto alternativo descriptivo
    Y el resto de la ficha se renderiza normalmente

  @negative @critical-path
  Escenario: N-4 — Un producto no publicado es indistinguible de uno inexistente
    Cuando un visitante abre la ficha del producto en borrador
    Y un visitante abre la ficha de un identificador inexistente
    Entonces ambas respuestas son 404 con el mismo mensaje
    Y ninguna revela el nombre del producto no publicado
