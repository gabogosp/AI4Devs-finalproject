# Charters exploratorios — US-014 Cuentas de cliente

> Exploración con **tiempo acotado**, no scripts. Lo que se busca es lo que un test
> automatizado no puede afirmar: si la experiencia **comunica** bien lo que el sistema
> hace, y si la superficie de seguridad se comporta razonablemente ante un humano que
> insiste. Los hallazgos se registran acá abajo, con fecha.

## TC-170 — Fuerza bruta y ventana de lockout · 45 min

**Riesgo que explora**: el lockout de US-014 es progresivo (`lockout_count` duplica la
ventana) y **persiste en la base**. Un bloqueo que no se comunica bien es
indistinguible de "olvidé la contraseña", y uno que se comunica **de más** delata que la
cuenta existe — justo lo que AC-5 prohíbe.

Recorrido sugerido:

1. Fallar el login de una cuenta **real** hasta el bloqueo. ¿En qué intento ocurre?
   ¿Coincide con `AUTH_LOGIN_MAX_FAILURES`?
2. Leer el mensaje con ojo de atacante: ¿dice o insinúa que la cuenta existe? Compararlo
   con el de una cuenta **inexistente** fallada la misma cantidad de veces.
3. Esperar la ventana y reintentar: ¿se desbloquea solo? ¿El segundo ciclo dura el doble?
4. Con la cuenta bloqueada, probar **recuperar la contraseña**: ¿el reset la desbloquea?
   Si no lo hace, la persona legítima queda sin salida y la única vía es soporte.
5. Mirar qué queda en los logs: ¿alcanza para que un operador entienda qué pasó, sin
   exponer credenciales?

**Hallazgos** · _(pendiente de ejecución)_

## TC-171 — El correo de recuperación como canal · 30 min

**Riesgo que explora**: el flujo automatizado usa el token que la API escribe en el log
(OQ-QA-4). Nadie verificó todavía el enlace **como lo recibe una persona**.

Recorrido sugerido:

1. Pedir recuperación con `RESEND_API_KEY` configurada y abrir el email en un cliente
   real (móvil y escritorio). ¿El enlace es clickeable y completo, sin cortes?
2. ¿El texto dice cuánto **dura** el enlace? `PASSWORD_RESET_TTL_MIN` es 60 min por
   default; si el email no lo menciona, quien lo abra al día siguiente no entiende por
   qué falla.
3. Abrirlo **dos veces**: la segunda tiene que rechazar (AC-7) con un mensaje que invite
   a pedir uno nuevo, no con un error técnico.
4. Pedir **dos** recuperaciones seguidas: ¿el primer enlace queda invalidado? Si los dos
   siguen sirviendo, la ventana de exposición se multiplica.
5. Revisar remitente y asunto: ¿parece legítimo o parece phishing? Es la primera vez que
   la tienda le escribe a esa persona.

**Hallazgos** · _(pendiente de ejecución)_

---

> Los dos charters son **manuales a propósito** (`execution_mode: manual` en
> `qa-plan.md` §4): automatizar la lectura de un email en un cliente real, o el juicio
> sobre si un mensaje "parece phishing", costaría más que el valor que da.
