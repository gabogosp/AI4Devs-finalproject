# language: es
@importar
Característica: Importación masiva de inventario (US-006)
  Como dueño del negocio
  quiero cargar y actualizar miles de SKUs desde un archivo
  para mantener el catálogo real sin hacerlo a mano

  Antecedentes:
    Dado el dueño autenticado en el panel

  @happy @critical-path
  Escenario: H-1 · TC-601 — Un archivo válido crea los SKUs nuevos y actualiza los existentes
    Dado un producto ya cargado con el SKU "REF-EXISTE" a $1000
    Y un archivo con ese SKU a $1500 y con dos SKUs que no existen
    Cuando el dueño importa el archivo
    Entonces la importación termina informando 2 productos creados y 1 actualizado
    Y el producto "REF-EXISTE" queda a $1500
    Y los dos SKUs nuevos existen en el catálogo con su nombre, precio y stock

  @happy
  Escenario: H-2 · TC-602 — Una categoría que no existe se crea una sola vez, sin importar cómo se escriba
    Dado que no existe la categoría "Plomería"
    Y un archivo con tres filas que la nombran "Plomería", "plomeria" y "PLOMERÍA"
    Cuando el dueño importa el archivo
    Entonces la importación termina informando 1 categoría creada
    Y los tres productos quedan en la misma categoría

  @happy @critical-path
  Escenario: H-3 · TC-603 — El archivo de ajuste de precios cambia sólo el precio
    Dado dos productos cargados con nombre, stock y categoría conocidos
    Y un archivo con sus SKUs y sus precios nuevos, con las demás celdas vacías
    Cuando el dueño importa el archivo
    Entonces los dos productos quedan con el precio nuevo
    Y conservan su nombre, su stock y su categoría
    Y no se crea ningún producto

  @happy
  Escenario: H-4 · TC-604 — La subida responde de inmediato y el progreso avanza hasta terminar
    Dado un archivo con 5000 filas válidas
    Cuando el dueño sube el archivo
    Entonces recibe de inmediato el identificador del trabajo sin esperar el procesamiento
    Y mientras el trabajo corre, la cantidad de filas procesadas nunca decrece
    Y al terminar, las filas procesadas igualan el total del archivo

  @happy
  Escenario: H-5 · TC-605 — El import deja pendientes de enriquecimiento sólo los que lo necesitan
    Dado un producto ya cargado con el SKU "REF-RICO"
    Y un archivo que a "REF-RICO" le cambia sólo el precio y trae además un SKU nuevo
    Cuando el dueño importa el archivo
    Entonces el SKU nuevo queda pendiente de enriquecimiento
    Y "REF-RICO" no suma un pendiente adicional por el cambio de precio

  @corner @critical-path
  Escenario: C-1 · TC-606 — Las filas buenas entran y las malas se reportan con su motivo
    Dado un archivo con 3 filas válidas y 4 con errores distintos
    Cuando el dueño importa el archivo
    Entonces los 3 productos válidos quedan en el catálogo
    Y la importación informa 4 filas rechazadas
    Y cada rechazo indica su número de fila y el motivo por el que se rechazó
    Y ninguna fila rechazada dejó un producto a medio crear

  @corner
  Escenario: C-2 · TC-607 — El reporte descargable trae una línea por fila rechazada
    Dado un archivo con 2 filas válidas y 2 con errores
    Cuando el dueño importa el archivo y descarga el reporte
    Entonces el reporte viene como archivo adjunto con un nombre que identifica la importación
    Y tiene una línea por cada fila rechazada, con su número de fila, su SKU y su motivo

  @corner
  Escenario: C-3 · TC-608 — Sin rechazos, el reporte existe y está vacío
    Dado un archivo con todas sus filas válidas
    Cuando el dueño importa el archivo y descarga el reporte
    Entonces el reporte tiene solamente el encabezado
    Y la descarga no falla

  @corner @critical-path
  Escenario: C-4 · TC-609 — Falta una columna requerida: se rechaza el archivo entero
    Dado un archivo sin la columna de precio
    Cuando el dueño lo sube
    Entonces el sistema lo rechaza informando qué columna falta
    Y el catálogo queda exactamente como estaba

  @corner
  Escenario: C-5 · TC-610 — Un formato que no se soporta se rechaza sin tocar el catálogo
    Dado un archivo que no es ni CSV ni Excel
    Cuando el dueño lo sube
    Entonces el sistema lo rechaza indicando que el formato no está soportado
    Y el catálogo queda exactamente como estaba

  @corner
  Escenario: C-6 · TC-611 — Un archivo que no está en UTF-8 se rechaza en vez de importarse mal
    Dado un archivo con acentos guardado en una codificación distinta de UTF-8
    Cuando el dueño lo sube
    Entonces el sistema lo rechaza pidiendo que lo guarde en UTF-8
    Y no queda ningún producto con caracteres corruptos en el catálogo

  @negative @critical-path
  Escenario: N-1 · TC-612 — Un archivo con más filas que el tope se rechaza antes de procesar
    Dado un archivo con una fila más que el tope permitido
    Cuando el dueño lo sube
    Entonces el sistema lo rechaza por exceder el límite de filas
    Y no se creó ni actualizó ningún producto

  @negative @critical-path
  Escenario: N-2 · TC-613 — El tamaño y la frecuencia tienen tope, y el tope se avisa
    Dado un archivo más grande que el tamaño permitido
    Cuando el dueño lo sube
    Entonces el sistema lo rechaza por tamaño sin haber leído su contenido
    Y cuando el dueño supera la cantidad de importaciones permitidas por hora
    Entonces el sistema le indica cuánto tiene que esperar

  @negative @critical-path
  Escenario: N-3 · TC-614 — Sin sesión de administrador no se importa nada
    Dado un visitante sin sesión de administrador
    Cuando intenta subir un archivo de importación
    Entonces el sistema le deniega el acceso
    Y cuando lo intenta con una sesión de cliente registrado
    Entonces el sistema también le deniega el acceso
    Y no se creó ningún trabajo de importación en ninguno de los dos intentos

  @negative @critical-path
  Escenario: N-4 · TC-615 — Importar dos veces el mismo archivo no duplica nada
    Dado un archivo con 3 SKUs nuevos
    Cuando el dueño lo importa dos veces
    Entonces existe exactamente un producto por cada SKU del archivo
    Y la segunda importación informa 0 creados y 3 actualizados

  @negative @critical-path
  Escenario: N-5 · TC-616 — Un producto importado no se publica solo
    Dado un archivo con un SKU que no existe en el catálogo
    Cuando el dueño lo importa
    Entonces el producto nuevo queda en borrador
    Y no aparece en el catálogo público del storefront
