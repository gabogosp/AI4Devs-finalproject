---
parent-us: US-014
discipline: qa
language: es
---

# US-014 QA — Tasks

> **14 tasks · 6,5 h AI-asistido / ~12 h tradicional.** La US §7 presupuesta `QA-US-014`
> en 8 h: el tradicional excede ~4 h porque la US contaba «tests de los formularios y
> del flujo» y la mayor parte del trabajo real es **infraestructura de QA que todavía no
> existe** para la cuenta del cliente (el harness sólo tiene helpers de admin) más las
> tres propiedades de seguridad —anti-enumeración con latencia, rotación del refresh,
> no-filtración de la contraseña— que no son features y no se prueban mirando la UI.
>
> Cada task se cierra cuando su `Verify:` pasa. Los comandos asumen la **raíz del repo**
> como cwd y el entorno de `qa-plan.md` §5 levantado.

## Mapa de cobertura (definición de cada caso)

Cada fila **define** su `TC-` en este documento; el escenario Gherkin completo vive en
`qa-plan.md` §3. `manual` no se scaffoldea: queda como checklist humano.

| TC | Task | AC | Capa | Estado |
|---|---|---|---|---|
| TC-140 | T1.1 | AC-1 | e2e | por ejecutar |
| TC-141 | T1.1 | AC-2 | e2e | por ejecutar |
| TC-142 | T1.1 | AC-3 | e2e | por ejecutar |
| TC-143 | T1.2 | AC-4 | e2e | por ejecutar |
| TC-144 | T2.1 | AC-5, AC-6, AC-11 | seguridad | por ejecutar |
| TC-145 | T1.2 | AC-7 | e2e | por ejecutar |
| TC-146 | T2.4 | AC-10 | seguridad | por ejecutar |
| TC-147 | T2.3 | AC-8 | seguridad | por ejecutar |
| TC-148 | T2.2 | AC-9 | seguridad | por ejecutar |
| TC-150 | T3.1 | AC-1, AC-2 | a11y | por ejecutar |
| TC-151 | T3.1 | AC-4 | a11y | por ejecutar |
| TC-160 | T4.1 | AC-2 (PRD §4) | carga | por ejecutar |
| TC-170 | T5.1 | AC-10 | exploratorio | **manual** |
| TC-171 | T5.1 | AC-4 | exploratorio | **manual** |

---

## Pre-requisitos

- [ ] **Backend y frontend de US-014 desarrollados.** Los dos changes están `in progress`
  con sus tasks cerradas; lo que este plan necesita es la superficie corriendo, no el plan.
  - **Verify**: `curl -sS -m 10 -o /dev/null -w "%{http_code}" "${QA_API_BASE_URL:-http://localhost:3009}/v1/auth/me" | grep -qx 401` (401 = la ruta existe y exige sesión) `&& curl -sS -m 10 -o /dev/null -w "%{http_code}" "${QA_WEB_BASE_URL:-http://localhost:3220}/ingresar" | grep -qx 200`
- [ ] **Entorno de QA arriba** según `qa-plan.md` §5, con el web **construido con el mismo
  puerto** con el que se sirve.
  - **Verify**: `curl -sS -m 10 "${QA_WEB_BASE_URL:-http://localhost:3220}/" | grep -qo "canonical\" href=\"${QA_WEB_BASE_URL:-http://localhost:3220}" || { echo "el web se construyó con otro origen: las canonical no coinciden"; exit 1; }`
- [ ] **La API expone el token de reset en test.** Sin eso, TC-143 y TC-145 no pueden
  seguir el enlace. El backend ya lo hace para su propia suite; hay que confirmar por qué
  variable se habilita.
  - **Verify**: `grep -rn "ultimoResetToken\|reset-token\|PASSWORD_RESET_TEST" apps/api/src/auth apps/web/e2e/support | head -3` devuelve al menos una coincidencia

---

## Fase 0: Soporte de cuenta de cliente en el harness — 1,2 h

- [ ] T0.1 `support/customer-auth.ts` — sembrar y autenticar una cuenta por la API real
  - **Pattern**: espejo de `support/admin-auth.ts` + `support/cart-client.ts`: cada cuenta
    vive en su propio `APIRequestContext` con su almacén de cookies, y **ninguna función
    recibe ni devuelve el token de sesión a mano** — pasarlo probaría que el servidor
    acepta un token, no que el cliente conserva su sesión.
  - **Exit criterion**: expone `nuevaCuenta()` (email con prefijo único por corrida, para
    que dos corridas no colisionen en la base compartida), `login(cuenta)`,
    `logout(sesion)` y `tokenDeReset(email)`; ninguna imprime la contraseña ni el token de
    sesión; cada cuenta es independiente (el lockout de una no afecta a otra).
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-140" --reporter=line 2>&1 | grep -qE '^ *1 passed'` (el helper queda ejercido por el primer escenario que lo usa; sin él, TC-140 no puede existir)

- [ ] T0.2 Prefijo único por corrida en los emails sembrados
  - **Exit criterion**: dos corridas consecutivas de la misma suite **no** colisionan por
    email ya registrado; el prefijo se deriva del timestamp como ya hace `builders` con
    SKU y slug.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-140" --reporter=line >/dev/null 2>&1 && pnpm --filter @dsm/qa test:e2e -- --grep "TC-140" --reporter=line 2>&1 | grep -qE '^ *1 passed'` (dos corridas seguidas; la segunda falla si el email se reusa)

---

## Fase 1: Recorrido de cuenta contra la API real — 1,8 h

- [ ] T1.1 TC-140 + TC-141 + TC-142 — registro, login y logout (AC-1, AC-2, AC-3)
  - **Pattern**: selectores por rol y nombre accesible, nunca CSS ni índices; esperar
    asertando el estado siguiente, nunca `waitForTimeout` — `per playwright-stability
    §Selectors + §Auto-waiting`.
  - **Exit criterion**: TC-140 verde — tras registrarse la sesión está activa **sin paso
    de verificación** y «mi cuenta» abre sin re-autenticar; TC-141 verde — la sesión
    **sobrevive una recarga completa** (si viviera sólo en memoria, esto lo caza); TC-142
    verde — tras el logout la sección de cuenta vuelve a pedir autenticación **y** el
    refresh anterior deja de servir contra la API.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-140|TC-141|TC-142" --reporter=line 2>&1 | grep -qE '^ *3 passed'`

- [ ] T1.2 TC-143 + TC-145 — recuperación completa y token muerto (AC-4, AC-7) — ⚠ **ESCRITO, BLOQUEADO POR ENTORNO**
  - **Exit criterion**: TC-143 verde — con el token que la API expone en test, se fija una
    contraseña nueva, se entra con ella y **no** se entra con la anterior (sin ese último
    assert, el escenario pasaría aunque la contraseña no hubiera cambiado); TC-145 verde —
    reusar el mismo enlace no permite cambiar nada y la pantalla indica pedir uno nuevo.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-143|TC-145" --reporter=line 2>&1 | grep -qE '^ *2 passed'`
  - **BLOQUEO (2026-08-23)**: los tres escenarios están escritos en
    `qa/e2e/cuenta-recuperacion.spec.ts` y **no pueden correr**: `POST /v1/auth/register`
    devuelve **429** incluso con un solo escenario y tras esperar, porque el contador por IP
    está agotado y la ventana es de 15 min (`AUTH_RATE_LIMIT_TTL_MS`).
    **La causa es que `AUTH_RATE_LIMIT_MAX=100000`, que `qa/scripts/api-up.sh` exporta
    justamente para esto, NO surte efecto en el throttler del registro** — verificado: la
    variable está en el entorno del proceso (`ps`) y el 429 igual sale de ese proceso (un
    solo listener en `:3009`, sin error de bind).
    Es un hallazgo del runbook de QA, no de US-014: el script promete algo que no cumple, y
    va a bloquear **toda** suite futura que registre cuentas reales. Sin resolverlo, las
    fases 2 a 5 de este plan tampoco pueden correr (todas empiezan registrando).
    Salidas posibles: (a) revisar por qué el throttler `auth` ignora la variable —puede leer
    otra clave o tener el valor fijo—; (b) que la suite corra desde IPs distintas por
    escenario, como ya hace `apps/api/test/e2e-app.ts` con `TRUST_PROXY_HOPS=1` y
    `X-Forwarded-For`. **(b) es la que ya tiene precedente en el repo.**
    `Deferred: desbloquear el entorno de QA para auth — owner: QA/BE`.

---

## Fase 2: Las tres propiedades de seguridad — 2,0 h

- [ ] T2.1 TC-144 — anti-enumeración en login, registro y recuperación (AC-5, AC-6, AC-11)
  - **Pattern**: `APIRequestContext` directo (no la UI): lo que hay que comparar es
    **status + cuerpo + latencia**, y el DOM no los muestra. Latencia como **banda
    amplia**, nunca un umbral fino (OQ-QA-3).
  - **Exit criterion**: para las tres superficies, el par (existente, inexistente) devuelve
    **el mismo status y el mismo cuerpo**; y el caso inexistente **no** responde en menos
    de un décimo del tiempo del existente. Los tres asserts corren sobre respuestas reales
    del backend, con bcrypt real —que es justo lo que introduce la diferencia de tiempo que
    este test acota—.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-144" --reporter=line 2>&1 | grep -qE '^ *1 passed'`

- [ ] T2.2 TC-148 — cookies y rotación del refresh (AC-9, ADR-0011)
  - **Exit criterion**: la cookie de sesión es `httpOnly` y **no** aparece en
    `document.cookie`; la de CSRF sí (el double-submit la necesita); usar el **mismo
    refresh dos veces** da error en el segundo uso y **revoca la familia** —verificado
    intentando refrescar de nuevo después—. Sin el segundo uso, «rotado» quedaría afirmado
    y no probado.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-148" --reporter=line 2>&1 | grep -qE '^ *1 passed'`

- [ ] T2.3 TC-147 — la contraseña no se filtra por ningún canal (AC-8)
  - **Pattern**: se captura el **stdout del proceso de la API** durante el escenario, no
    sólo las respuestas: un log con la credencial es el modo de fallo real y no se ve desde
    el cliente.
  - **Exit criterion**: ni la contraseña en claro ni su hash aparecen en ninguna respuesta
    de registro, login o recuperación; y el log del proceso durante el escenario no
    contiene la contraseña. El escenario usa una contraseña **canario** irrepetible para
    que la búsqueda no dé falsos negativos.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-147" --reporter=line 2>&1 | grep -qE '^ *1 passed'`

- [ ] T2.4 TC-146 — límite de intentos con el rate-limit REAL (AC-10)
  - **Pattern**: proceso de API **aparte**, con `AUTH_RATE_LIMIT_MAX` en su valor de
    producción; el resto de la suite corre con el elevado o se autobloquea.
  - **Exit criterion**: superado el límite desde la misma IP, las solicitudes siguientes
    son **429** y la respuesta trae `Retry-After`; el escenario **no** depende de ningún
    header de fuerza (que es como lo simula el stub del FE) sino del límite real.
  - **Verify**: `QA_API_PORT=3011 AUTH_RATE_LIMIT_MAX=5 pnpm --filter @dsm/qa test:e2e -- --grep "TC-146" --reporter=line 2>&1 | grep -qE '^ *1 passed'`

---

## Fase 3: Accesibilidad — 1,0 h

- [ ] T3.1 TC-150 + TC-151 — axe AA y teclado en los cuatro formularios (US §9)
  - **Pattern**: `AxeBuilder` con `withTags(['wcag2a','wcag2aa'])`, espejo de
    `qa/e2e/ficha-a11y.spec.ts`; el archivo tiene que terminar en `a11y.spec.ts` o el
    config de e2e lo excluye y el de a11y no lo toma.
  - **Exit criterion**: cero violaciones AA en registro, login, pedido de recuperación y
    confirmación; los cuatro se completan y envían **sólo con teclado**; y cada error de
    validación queda **asociado a su campo** por nombre accesible (un error suelto en la
    página no le dice a un lector de pantalla qué campo corregir, y axe no lo detecta).
  - **Verify**: `pnpm --filter @dsm/qa test:a11y -- --grep "TC-150|TC-151" --reporter=line 2>&1 | grep -qE '^ *[2-9] passed'`

---

## Fase 4: Carga — 0,8 h

- [ ] T4.1 TC-160 — login bajo carga contra el presupuesto del PRD (§4)
  - **Pattern**: escenario k6 en `qa/performance/auth-login.js`, espejo de
    `cart-write.js`, con `thresholds` explícitos — `per performance-standards.md §7: un
    test de carga sin umbral numérico no es un test`.
  - **Exit criterion**: `http_req_duration{p(95)} < 500` (PRD §4, escritura) y
    `http_req_failed < 0.01` con 10 VUs / 30 s; corre con el rate-limit **elevado** para
    medir latencia y no el 429; el umbral está en el script y **falla la corrida** si se
    supera (no es un dato informativo).
  - **Verify**: `pnpm --filter @dsm/qa test:load:auth 2>&1 | grep -qE "✓ http_req_duration|thresholds .*passed"` (el script se agrega a `qa/package.json`)

---

## Fase 5: Exploratorio y cierre — 0,7 h

- [ ] T5.1 Charters TC-170 y TC-171 (manual)
  - **Exit criterion**: `qa/exploratory/us-014-cuentas.md` documenta los dos charters con
    su tiempo asignado, el riesgo que exploran y dónde se registran los hallazgos: fuerza
    bruta y **ventana de lockout** (¿el bloqueo se comunica sin revelar si el email
    existe?), y el correo de recuperación como canal (enlace en un cliente real,
    expiración a la vista, reuso). Quedan como checklist humano; `/develop-qa` no los
    scaffoldea.
  - **Verify**: `test -f qa/exploratory/us-014-cuentas.md && grep -q "TC-170" qa/exploratory/us-014-cuentas.md && grep -q "TC-171" qa/exploratory/us-014-cuentas.md`

- [ ] T5.2 Trazabilidad AC → escenario, sin huecos
  - **Exit criterion**: los 11 AC de US-014 aparecen en la matriz de `qa-plan.md` §2 con al
    menos una capa QA-owned **o** una nota explícita de por qué la dev-owned alcanza; y
    cada `TC-` de la matriz existe como test o como charter.
  - **Verify**: `python3 -c "
import re,sys,pathlib
plan=pathlib.Path('openspec/changes/US-014-registro-login-qa/qa-plan.md').read_text()
acs=set(re.findall(r'AC-(\d+)', pathlib.Path('docs/user-stories/US-014-registro-login.md').read_text()))
faltan=[a for a in acs if f'AC-{a} ' not in plan and f'AC-{a},' not in plan and f'AC-{a})' not in plan]
tcs=set(re.findall(r'TC-(\d{3})', plan))
sys.exit(0 if not faltan and len(tcs)>=13 else 1)"`

---

## Verification (suite-level)

- [ ] Suite QA de cuentas verde: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-140|TC-141|TC-142|TC-143|TC-144|TC-145|TC-146|TC-147|TC-148" --reporter=line`
- [ ] a11y verde: `pnpm --filter @dsm/qa test:a11y -- --grep "TC-150|TC-151" --reporter=line`
- [ ] Carga dentro del presupuesto: `pnpm --filter @dsm/qa test:load:auth`
- [ ] **Sin regresión en las suites QA ya existentes**:
      `pnpm --filter @dsm/qa test:e2e -- --grep "TC-(2|3|7)[0-9]{2}" --reporter=line`
      *(los patrones van así y no como una sola alternancia entre comillas: el filtro de
      Playwright acepta regex, pero el de vitest —que otras tasks usan— es substring, y ese
      detalle ya hizo pasar en verde un gate que no corría nada)*
- [ ] Los dos charters manuales ejecutados y sus hallazgos registrados (humano)

## Trazabilidad AC → escenario

| AC de US-014 | Escenarios QA-owned |
|---|---|
| AC-1 registro con sesión inmediata | TC-140, TC-150 |
| AC-2 login | TC-141, TC-150, TC-160 |
| AC-3 logout invalida | TC-142 |
| AC-4 recuperación | TC-143, TC-151 |
| AC-5 login inválido genérico | TC-144 |
| AC-6 registro con email existente | TC-144 |
| AC-7 token expirado o usado | TC-145 |
| AC-8 contraseña nunca expuesta | TC-147 |
| AC-9 cookie + refresh rotado | TC-148 |
| AC-10 límite de intentos | TC-146, TC-170 (charter) |
| AC-11 reset de email inexistente | TC-144 |
