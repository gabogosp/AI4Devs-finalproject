# language: es
@acceptance @regression
Característica: Administración del catálogo (US-001) — cross-stack contra la API real

  @happy @critical-path
  Escenario: H-1 Ciclo completo del catálogo (AC-1, AC-2, AC-4, AC-7)
    Dado una sesión admin válida
    Cuando creo una categoría
    Entonces la categoría tiene un slug único derivado
    Cuando creo un producto en esa categoría
    Entonces el producto queda en estado "draft"
    Cuando publico el producto
    Entonces el producto queda en estado "published"
    Cuando archivo el producto
    Entonces el producto queda en estado "archived"

  @happy
  Escenario: H-2 El alta de categoría deriva un slug válido (AC-1)
    Dado una sesión admin válida
    Cuando creo una categoría
    Entonces la categoría tiene un slug único derivado

  @corner
  Escenario: C-1 Un producto archivado no se puede publicar (transición terminal)
    Dado una sesión admin válida
    Cuando creo una categoría
    Y creo un producto en esa categoría
    Cuando intento publicar un producto archivado
    Entonces la respuesta es 422

  @negative
  Esquema del escenario: N-1 Validación por campo rechaza y no crea (AC-5)
    Dado una sesión admin válida
    Cuando creo una categoría
    Y intento crear un producto con <campo> inválido
    Entonces la respuesta es 422
    Ejemplos:
      | campo  |
      | precio |
      | stock  |
      | nombre |

  @negative
  Escenario: N-4 category_id inexistente rechazado (AC-5 / FK)
    Dado una sesión admin válida
    Cuando creo una categoría
    Y intento crear un producto con categoria inválido
    Entonces la respuesta es 422

  @negative
  Escenario: N-5 SKU duplicado → 409, no crea el segundo (AC-9)
    Dado una sesión admin válida
    Cuando creo una categoría
    Y creo un producto con un SKU nuevo
    Entonces la respuesta es 201
    Cuando creo otro producto con el mismo SKU
    Entonces la respuesta es 409

  @negative
  Escenario: N-8 Sin sesión admin → 401 (AC-8)
    Cuando un visitante sin sesión pide POST "/v1/admin/products"
    Entonces la respuesta es 401

  @critical-path
  Escenario: X-6 La suite ejercita el login real (no el fallback)
    Entonces el fixture de auth resuelve por login real

  @deferred
  Escenario: AC-10 El precio no altera ventas pasadas (diferido — sin checkout en US-001)
    Dado una sesión admin válida
