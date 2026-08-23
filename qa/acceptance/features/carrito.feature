# language: es
@carrito
Característica: Carrito de compra del invitado (US-007)
  Como cliente invitado del storefront
  quiero armar mi carrito sin crear una cuenta
  para decidir qué comprar y avanzar al pago cuando quiera

  Antecedentes:
    Dado un catálogo sembrado con productos para el carrito

  @happy @critical-path
  Escenario: TC-701 — Agregar un producto publicado lo muestra con su precio y actualiza el total
    Cuando un invitado agrega 2 unidades de un producto publicado a su carrito
    Entonces el carrito muestra ese producto con 2 unidades
    # El precio que asserta el test es el que el dueño le puso al sembrarlo, no
    # uno cualquiera: así el test falla si el carrito inventa o arrastra otro.
    Y muestra el precio unitario que el dueño le puso
    Y el subtotal de la línea es el precio por la cantidad
    Y el total del carrito refleja esa línea

  @happy @critical-path
  Escenario: TC-702 — Cambiar la cantidad recalcula el subtotal y el total
    Dado un invitado con 1 unidad de un producto en su carrito
    Cuando cambia la cantidad de ese producto a 3
    Entonces el subtotal de la línea acompaña la cantidad nueva
    Y el total del carrito se recalcula

  @happy
  Escenario: TC-703 — Quitar un producto lo saca del carrito y recalcula el total
    Dado un invitado con dos productos distintos en su carrito
    Cuando quita uno de los dos
    Entonces ese producto ya no está en el carrito
    Y el total del carrito es el del producto que queda

  @happy @critical-path
  Escenario: TC-704 — El carrito sigue ahí en la visita siguiente, sin cuenta de por medio
    Dado un invitado con dos productos distintos en su carrito
    # "Cerrar el navegador" es descartar el contexto y abrir uno nuevo con sólo
    # las cookies persistentes. Reusar el mismo contexto no probaría nada.
    Cuando cierra el navegador y vuelve conservando sólo sus cookies persistentes
    Entonces recupera el mismo carrito con los dos productos
    Y no tuvo que crear ninguna cuenta

  @corner @critical-path
  Escenario: TC-705 — No se puede pedir más de lo que hay, y el carrito no queda a medias
    Dado un invitado con 2 unidades del producto de stock limitado en su carrito
    Cuando intenta subir la cantidad a 4
    Entonces el sistema rechaza la operación
    Y le informa cuántas unidades hay realmente disponibles
    # Un rechazo que dejara la línea a medias pasaría un test que sólo mirara el
    # status: por eso se asserta también el estado del carrito después.
    Y su carrito sigue teniendo las 2 unidades de antes

  @corner
  Escenario: TC-706 — Un invitado sin carrito ve el estado vacío, y mirarlo no le crea uno
    Dado un invitado que nunca agregó nada
    Cuando abre su carrito
    Entonces ve un carrito vacío, sin error
    Cuando lo vuelve a abrir
    Entonces sigue viendo un carrito vacío
    Y el sistema no le abrió ningún carrito por haberlo mirado

  @corner
  Escenario: TC-707 — Con una línea comprable y otra bloqueada, el total sólo cuenta lo comprable
    Dado un invitado con dos productos distintos en su carrito
    Cuando el dueño despublica uno de los dos
    Y el invitado abre su carrito
    Entonces ve las dos líneas, cada una con su propio subtotal
    Y el total del carrito es solamente el de la línea que sí puede comprar
    Y el carrito avisa que hay algo que impide avanzar al pago
