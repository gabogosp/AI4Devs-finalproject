# language: es
@perfil @us-024
Característica: Edición de perfil del cliente (US-024)
  Como cliente registrado de DSM
  quiero editar mi nombre y mi avatar desde "Mi cuenta"
  para que mi cuenta refleje quién soy

  Antecedentes:
    Dado un cliente autenticado con sesión válida

  @happy @critical-path
  Escenario: SC-024-H1 — Editar el nombre (AC-1)
    Cuando cambia su nombre a "Ana María Pérez" y guarda
    Entonces el nombre se actualiza de inmediato

  @happy
  Escenario: SC-024-H2 — Agregar un avatar por URL (AC-2)
    Cuando pega "https://ejemplo.com/foto.jpg" como avatar y guarda
    Entonces el avatar se actualiza a esa URL

  @happy
  Escenario: SC-024-H3 — Quitar el avatar (AC-3)
    Dado que ya tiene un avatar configurado
    Cuando borra la URL de avatar y guarda
    Entonces su avatar queda en null

  @negative
  Escenario: SC-024-N1 — Nombre vacío es rechazado (AC-4)
    Cuando intenta guardar el nombre vacío
    Entonces el perfil recibe un error de validación
    Y su nombre anterior no cambia

  @negative
  Escenario: SC-024-N2 — URL de avatar inválida es rechazada (AC-5)
    Cuando pega "no-es-una-url" como avatar y guarda
    Entonces el perfil recibe un error de validación

  @negative @critical-path
  Escenario: SC-024-N3 — El email no es editable desde este endpoint (AC-6)
    Cuando intenta actualizar su perfil incluyendo un campo email
    Entonces el endpoint rechaza la request entera (no admite ese campo)
    Y su email real no cambió

  @negative @critical-path
  Escenario: SC-024-N4 — No se puede editar el perfil de otro cliente (AC-7)
    Dado otro cliente autenticado con su propio nombre
    Cuando el primer cliente actualiza su propio perfil
    Entonces el nombre del segundo cliente no cambia
