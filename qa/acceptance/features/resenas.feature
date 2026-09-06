# language: es
@resenas @us-025
Característica: Reseñas y calificaciones de productos (US-025)
  Como cliente que compró un producto
  quiero calificarlo con estrellas y un comentario
  para ayudar a otros compradores a decidir

  @happy @critical-path
  Escenario: SC-025-H1 — Dejar una reseña de un producto comprado y entregado (AC-1)
    Dado un cliente con una orden delivered de un producto publicado
    Cuando deja una reseña de 4 estrellas con comentario "Anduvo bien"
    Entonces la reseña se guarda con esa calificación y comentario

  @happy
  Escenario: SC-025-H2 — Calificar sin comentario (AC-2)
    Dado un cliente con una orden delivered de un producto publicado
    Cuando deja una reseña de 5 estrellas sin comentario
    Entonces la reseña se guarda igual, sin comentario

  @happy
  Escenario: SC-025-H3 — Ver el promedio y el conteo en la ficha (AC-3)
    Dado un producto con reseñas de 5, 4 y 3 estrellas de clientes distintos
    Cuando cualquier persona consulta las reseñas públicas de ese producto
    Entonces ve el promedio "4" y "3" reseñas

  @happy
  Escenario: SC-025-H4 — Producto sin reseñas todavía (AC-4)
    Dado un producto publicado sin ninguna reseña
    Cuando cualquier persona consulta sus reseñas públicas
    Entonces el promedio es null y el conteo es 0

  @happy @critical-path
  Escenario: SC-025-H5 — Editar la propia reseña (AC-5)
    Dado un cliente que ya dejó una reseña de 3 estrellas de un producto
    Cuando cambia su calificación a 5 estrellas del mismo producto
    Entonces se actualiza la MISMA reseña, sin aumentar el conteo total

  @happy
  Escenario: SC-025-H6 — El dueño oculta una reseña, a nivel API (AC-8)
    Dado una reseña visible de un producto
    Cuando el dueño la oculta desde el endpoint de moderación
    Entonces deja de contarse en el promedio público
    Y el cliente autor, al consultar su propia reseña, la ve marcada como oculta

  @negative @critical-path
  Escenario: SC-025-N1 — No comprado (o no entregado) → no puede reseñar (AC-6)
    Dado un cliente autenticado que nunca compró un producto publicado
    Cuando intenta dejar una reseña de ese producto
    Entonces el sistema lo rechaza con 403
    Y no se guarda ninguna reseña

  @negative @critical-path
  Escenario: SC-025-N2 — Invitado no puede reseñar (AC-7)
    Dado una persona sin sesión iniciada
    Cuando intenta dejar una reseña de un producto publicado
    Entonces el sistema lo rechaza sin crear ninguna reseña

  @negative
  Escenario: SC-025-N3 — Calificación fuera de rango es rechazada (AC-9)
    Dado un cliente con una orden delivered de un producto publicado
    Cuando intenta dejar una reseña con 6 estrellas
    Entonces recibe un error de validación
    Y no se guarda ninguna reseña
