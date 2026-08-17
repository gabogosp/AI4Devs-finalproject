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

  # BLOQUEADO POR DECISIÓN, no por defecto. Conflicto entre dos decisiones
  # documentadas: D-2 (PO, US-003 §10) dice que el CTA va ACTIVO contra un seam;
  # D6 (design.md del change de FE) lo dejó DESHABILITADO, argumentando que un
  # botón activo sin destino erosiona la confianza (design-system §7.14).
  # La aserción NO se debilita: queda escrita como la pide AC-3 + D-2 y se
  # excluye por tag hasta que el PO resuelva cuál de las dos vale.
  @happy @blocked-by-decision
  Escenario: H-3 — Un producto con stock ofrece iniciar la compra
    Cuando un visitante abre la ficha del producto publicado
    Entonces se ofrece la acción de agregar al carrito

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
