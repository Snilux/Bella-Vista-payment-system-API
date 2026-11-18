# Contrato de la API

Fuente: documento 2.3 de Notion. Los esquemas de entrada y salida se definen con Zod en `packages/shared/src/schemas` y los usan la API y la app.

> Rutas, parámetros, campos JSON, valores de enum y códigos de error van con su **nombre real en el código** (en inglés); la redacción sigue en español, y los mensajes (`message`) que ve el usuario, en español con trato de usted. [glosario.md](glosario.md) da la equivalencia con los términos de negocio. La prueba `apps/api/test/unit/routes-contract.test.ts` compara las tablas de [Endpoints](#endpoints) con las rutas que registra Fastify y falla si difieren: cada fila lleva **un método y una ruta**.

## Convenciones

| Tema          | Regla |
| ------------- | ----- |
| Base          | `/v1`, solo HTTPS en producción, JSON UTF-8. Rutas en inglés y `kebab-case`; campos JSON y parámetros de consulta en `camelCase`. `/health` queda fuera de `/v1` |
| Autenticación | `Authorization: Bearer <token de acceso>` en todo excepto login, refresco y `/health` |
| Idempotencia  | `Idempotency-Key: <uuid>` obligatorio en los POST que mueven dinero (pagos, cancelaciones, entregas, gastos, ingresos, pagos al fontanero, saldos iniciales) |
| Dinero        | Enteros en centavos (`amount: 5000` = $50.00) |
| Periodos      | `AAAA-MM` |
| Fechas        | ISO 8601 (`2026-10-25`, `2026-10-25T18:30:00Z`) |
| Paginación    | `?limit=20&cursor=...` → `{ "data": [], "next": "cursor" }` (`next` es `null` en la última página) |
| Alcance       | La API filtra por manzana según el cargo de la cuenta; un JM nunca recibe datos de pago de otras manzanas |
| Errores       | `{ "error": { "code": "PERIOD_ALREADY_PAID", "message": "Junio 2026 ya está pagado.", "details": {} } }` |
| Registros     | Sin secretos ni datos personales (RNF-SEG-06): la ruta se registra sin parámetros de búsqueda; `Authorization`, contraseñas y tokens siempre se ocultan; los errores de base de datos se registran sin la consulta ni sus valores |

| HTTP | Uso                                                                          |
| ---- | ---------------------------------------------------------------------------- |
| 400  | Datos inválidos (Zod)                                                        |
| 401  | Sin sesión o token vencido                                                   |
| 403  | El cargo de la cuenta no tiene permiso o alcance                             |
| 404  | No existe o no es visible para el cargo                                      |
| 409  | Conflicto (importe cambió, periodo ya pagado, folio repetido, corte cerrado) |
| 422  | Regla de negocio no cumplida (orden de meses, saldo insuficiente)            |
| 429  | Demasiadas solicitudes en poco tiempo                                        |
| 500  | Error inesperado del servidor (sin detalles internos)                        |
| 503  | La base de datos no responde                                                 |

## Endpoints

### Salud

| Método | Ruta    | Descripción                                        | Roles   |
| ------ | ------- | -------------------------------------------------- | ------- |
| GET    | /health | 200 si la API y la base responden; si no, `DATABASE_UNAVAILABLE` | Público |

### Sesión y cuentas (no hay registro público)

| Método | Ruta                               | Descripción                                                                                            | Roles             |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------- |
| POST   | /v1/auth/login                     | Usuario y contraseña; devuelve tokens, el cargo de la cuenta y si debe cambiar la contraseña           | Público           |
| POST   | /v1/auth/refresh                   | Rota el token de refresco                                                                              | Público con token |
| POST   | /v1/auth/change-password           | Obligatorio si `mustChangePassword`                                                                    | Todos             |
| POST   | /v1/auth/logout                    | Revoca el token de refresco                                                                            | Todos             |
| GET    | /v1/accounts                       | Cuentas y asignaciones vigentes sin cuenta                                                             | SA                |
| POST   | /v1/accounts                       | Crea la cuenta de una asignación (el cargo sale de ella); devuelve la contraseña temporal una sola vez | SA                |
| POST   | /v1/accounts/{id}/reset-password   | Contraseña temporal y cierre de sesiones (motivo opcional)                                             | SA                |
| POST   | /v1/accounts/{id}/lock             | Bloquea la cuenta (con motivo)                                                                         | SA                |
| POST   | /v1/accounts/{id}/unlock           | Desbloquea la cuenta (con motivo)                                                                      | SA                |
| POST   | /v1/accounts/{id}/deactivate       | Desactiva la cuenta (con motivo)                                                                       | SA                |

### Organización

| Método | Ruta                                    | Descripción                                                  | Roles                |
| ------ | --------------------------------------- | ------------------------------------------------------------ | -------------------- |
| GET    | /v1/sections                            | Catálogo                                                     | Todos                |
| POST   | /v1/sections                            | Alta de sección                                              | SEC                  |
| PATCH  | /v1/sections/{id}                       | Nombre y `active` (la clave no cambia)                       | SEC                  |
| GET    | /v1/blocks?sectionId=                   | Catálogo con jefe vigente                                    | Todos                |
| POST   | /v1/blocks                              | Alta de manzana                                              | SEC                  |
| GET    | /v1/blocks/{id}                         | Ficha con jefe vigente                                       | Comité, JM           |
| PATCH  | /v1/blocks/{id}                         | Nombre y `active` (la clave no cambia)                       | SEC                  |
| POST   | /v1/blocks/{id}/leader-substitution     | Sustitución con corte extraordinario (paso 8 de la API)      | SEC                  |
| GET    | /v1/role-assignments?status=&role=&blockId= | Cargos vigentes e históricos                             | Comité               |
| POST   | /v1/role-assignments                    | Registra asignación (crea autorización)                      | SEC                  |
| POST   | /v1/role-assignments/{id}/close         | Fin de periodo de un cargo del comité (desactiva su cuenta)  | SEC                  |

### Padrón y tomas

| Método | Ruta                                                              | Descripción                                                       | Roles                   |
| ------ | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------- |
| GET    | /v1/search?q=                                                     | Búsqueda de personas, tomas y unidades                            | JM, comité              |
| GET    | /v1/people/matches?givenNames=&paternalSurname=&maternalSurname=  | Homónimos antes de crear                                          | JM, SEC                 |
| POST   | /v1/people                                                        | Crea persona (exige distintivo si hay homónimo)                   | JM, SEC                 |
| GET    | /v1/people/{id}                                                   | Ficha con unidades según alcance                                  | Según alcance           |
| POST   | /v1/connections/pre-existing                                      | Toma capturada al arranque                                        | JM, SEC                 |
| GET    | /v1/connections/{id}                                              | Ficha con sus unidades                                            | Según alcance           |
| POST   | /v1/units                                                         | Crea unidad (en toma existente o al arranque con `billingStartPeriod`) | JM, SEC            |
| GET    | /v1/units/{id}                                                    | Ficha                                                             | Según alcance           |
| GET    | /v1/units/{id}/account-statement                                  | Meses con base, recargo, total y estado (paso 5 de la API)        | Según alcance           |
| POST   | /v1/units/{id}/request-deactivation                               | Crea autorización                                                 | JM, SEC                 |
| POST   | /v1/units/{id}/request-holder-change                              | Crea autorización                                                 | JM, SEC                 |
| GET    | /v1/suspensions?status=&connectionId=&unitId=                     | Suspensiones vigentes (o terminadas) con su toma o unidad         | Comité                  |
| POST   | /v1/suspensions                                                   | Suspende toma o unidad                                            | SEC, PRE                |
| POST   | /v1/suspensions/{id}/end                                          | Reactiva                                                          | SEC, PRE                |
| GET    | /v1/connection-requests?status=&blockId=                          | Lista                                                             | Comité, JM (su manzana) |
| POST   | /v1/connection-requests                                           | Registro                                                          | JM (su manzana), SEC    |
| GET    | /v1/connection-requests/{id}                                      | Detalle con acuerdo y cargo de apertura                           | Comité, JM (su manzana) |
| POST   | /v1/connection-requests/{id}/resolve                              | Aprobar o rechazar con acuerdo                                    | SEC                     |
| POST   | /v1/connection-requests/{id}/activate                             | Instalación y primera unidad                                      | JM, SEC                 |
| POST   | /v1/connection-requests/{id}/cancel                               | Cancela antes del pago (D-12); anula el cargo de apertura         | SEC, JM (su manzana)    |
| GET    | /v1/agreements                                                    | Acuerdos de junta                                                 | Comité                  |
| POST   | /v1/agreements                                                    | Registra acuerdo                                                  | SEC                     |

### Tarifas y conceptos

| Método | Ruta                    | Descripción                         | Roles |
| ------ | ----------------------- | ----------------------------------- | ----- |
| GET    | /v1/rates               | Historial                           | Todos |
| POST   | /v1/rates               | Registra tarifa (crea autorización) | TES   |
| GET    | /v1/fees                | Conceptos con su importe vigente    | Todos |
| POST   | /v1/fees                | Crea concepto                       | TES   |
| POST   | /v1/fees/{id}/amounts   | Agrega un importe desde una fecha   | TES   |

### Cobranza

| Método | Ruta                                    | Descripción                    | Roles                |
| ------ | --------------------------------------- | ------------------------------ | -------------------- |
| POST   | /v1/payments/preview                    | Calcula el total sin guardar   | JM, TES, PRE         |
| POST   | /v1/payments                            | Registra pago                  | JM, TES, PRE         |
| GET    | /v1/payments?unitId=&blockId=&from=&to= | Lista                          | Según alcance        |
| GET    | /v1/payments/{id}                       | Detalle con recibos de papel   | Según alcance        |
| POST   | /v1/payments/{id}/replacements          | Reposición de recibo           | JM (su manzana), TES |
| POST   | /v1/payments/{id}/request-cancellation  | Crea autorización              | JM, TES              |
| GET    | /v1/units/{id}/extra-charges?status=    | Cargos de la familia y su toma | Según alcance        |
| POST   | /v1/extra-charges                       | Crea cargo extraordinario      | TES                  |
| POST   | /v1/extra-charges/{id}/cancel           | Cancela cargo no pagado        | TES                  |

### Cajas

| Método | Ruta                                  | Descripción                                     | Roles                         |
| ------ | ------------------------------------- | ----------------------------------------------- | ----------------------------- |
| GET    | /v1/cashboxes/mine                    | Caja del cargo de la cuenta con saldo y resumen | JM, TES, PRE (apoyo)          |
| GET    | /v1/cashboxes                         | Cajas con su saldo esperado                     | Comité                        |
| GET    | /v1/cashboxes/{id}/movements          | Movimientos                                     | Custodio, comité              |
| POST   | /v1/cashboxes/{id}/opening-balance    | Saldo inicial (crea autorización)               | TES                           |
| GET    | /v1/handovers?status=                 | Lista                                           | JM, PRE (las suyas), TES, VOC |
| POST   | /v1/handovers                         | Prepara una entrega                             | JM, PRE                       |
| GET    | /v1/handovers/{id}                    | Detalle de la entrega                           | JM, PRE (las suyas), TES, VOC |
| POST   | /v1/handovers/{id}/withdraw           | Retira entrega pendiente                        | Quien la preparó              |
| POST   | /v1/handovers/{id}/confirm            | Captura importe recibido                        | TES                           |
| POST   | /v1/adjustments                       | Propone aclaración (crea autorización)          | TES                           |

### Comité

| Método | Ruta                                  | Descripción                                          | Roles                 |
| ------ | ------------------------------------- | ---------------------------------------------------- | --------------------- |
| GET    | /v1/incomes                           | Otros ingresos                                       | Comité                |
| POST   | /v1/incomes                           | Registra ingreso                                     | TES                   |
| GET    | /v1/expense-categories                | Categorías de gasto                                  | Comité                |
| GET    | /v1/expenses?status=                  | Gastos                                               | Comité                |
| POST   | /v1/expenses                          | Registra gasto                                       | TES                   |
| GET    | /v1/expenses/{id}                     | Detalle del gasto                                    | Comité                |
| POST   | /v1/expenses/{id}/pay                 | Marca pagado y descuenta caja                        | TES                   |
| POST   | /v1/expenses/{id}/reject              | Rechaza gasto pendiente                              | TES                   |
| POST   | /v1/expenses/{id}/request-refund      | Crea autorización                                    | TES                   |
| GET    | /v1/plumbers                          | Fontaneros con su salario vigente                    | Comité                |
| POST   | /v1/plumbers                          | Registra fontanero                                   | TES                   |
| GET    | /v1/plumbers/{id}                     | Ficha con salarios y pagos                           | Comité                |
| PATCH  | /v1/plumbers/{id}                     | Edita teléfono y `active`                            | TES                   |
| POST   | /v1/plumbers/{id}/salaries            | Nuevo salario (crea autorización)                    | TES                   |
| POST   | /v1/plumbers/{id}/payments            | Paga un periodo con el salario vigente               | TES                   |

### Cortes, autorizaciones, reportes y bitácora

| Método | Ruta                                                                    | Descripción                                  | Roles                              |
| ------ | ----------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| GET    | /v1/closings?cashboxId=&period=&status=                                 | Lista                                        | Según alcance                      |
| GET    | /v1/closings/{id}                                                       | Detalle con cifras                           | Según alcance                      |
| POST   | /v1/closings                                                            | Abre corte (calcula cifras)                  | JM, TES                            |
| POST   | /v1/closings/{id}/count                                                 | Efectivo contado y observaciones             | Quien lo prepara                   |
| POST   | /v1/closings/{id}/review                                                | Marca revisado                               | PRE, VOC                           |
| POST   | /v1/closings/{id}/close                                                 | Cierra y bloquea el periodo                  | PRE, VOC                           |
| GET    | /v1/approvals?status=pending                                            | Bandeja                                      | PRE (y cada solicitante las suyas) |
| GET    | /v1/approvals/{id}                                                      | Detalle con su registro (`subject`)          | PRE (y cada solicitante las suyas) |
| POST   | /v1/approvals/{id}/resolve                                              | Autoriza o rechaza con motivo                | PRE                                |
| GET    | /v1/reports/block?blockId=&from=&to=                                    | Datos del reporte por manzana                | JM (su manzana), comité            |
| GET    | /v1/reports/community?from=&to=                                         | Datos del reporte comunitario                | Comité                             |
| GET    | /v1/audit-log?userAccountId=&tableName=&recordId=&action=&from=&to=     | Bitácora filtrada y paginada                 | PRE, SA (técnica)                  |

Los reportes devuelven JSON; la app genera el PDF.

## Detalle: sesión y cuentas

**Login** `POST /v1/auth/login` con `{ "username": "tesorero", "password": "..." }`. Respuesta 200:

```json
{
  "accessToken": "eyJ...",
  "accessTokenExpiresIn": 900,
  "refreshToken": "q3Vx...",
  "account": {
    "username": "tesorero",
    "role": "treasurer",
    "blockId": null,
    "blockCode": null,
    "fullName": "Rosa María Salinas Vega",
    "mustChangePassword": false
  }
}
```

- `account` es lo que la app necesita de la cuenta (C-05 Perfil): `fullName` es el nombre completo de la persona del cargo y `blockCode` la clave visible de la manzana del jefe (`S1-M03`; `null` en los demás cargos). El refresco y el cambio de contraseña devuelven el mismo objeto.
- El token de acceso dura 15 min y lleva la cuenta, el usuario, el cargo y la manzana. El de refresco dura 30 días y solo se guarda su hash (SHA-256).
- Usuario inexistente o contraseña incorrecta → `INVALID_CREDENTIALS`. Al quinto intento fallido seguido la cuenta se bloquea 15 min (`ACCOUNT_LOCKED`, con `details.lockedUntil`). Mientras esté bloqueada no se revisa la contraseña.
- Con la contraseña correcta: cuenta desactivada → `ACCOUNT_DISABLED`; asignación cerrada, pendiente o sin iniciar → `ROLE_NOT_ACTIVE`.
- Límite (RNF-SEG-07): 10 solicitudes por minuto por IP en login y refresco, y 10 intentos de login por minuto por usuario aunque lleguen de IPs distintas (`TOO_MANY_REQUESTS`, con el encabezado `Retry-After`). Los mensajes del login no cambian; cada bloqueo automático queda en la bitácora técnica.
- IP del cliente: la API solo toma la IP de `X-Forwarded-For` si viene de un proxy de confianza, según la variable `TRUST_PROXY`: `false` (por omisión, sin proxy), el número de proxies delante de la API (p. ej. `1` detrás del proxy HTTPS de la plataforma) o sus direcciones/CIDR separadas por comas. Nunca `true`: cualquier cliente podría inventar una IP por intento y saltarse el límite.

**Refresco** `POST /v1/auth/refresh` con `{ "refreshToken": "..." }`: revoca el token recibido y entrega un par nuevo. Si llega un token que ya fue rotado o revocado, se revoca **toda su cadena** (detección de robo) y responde `UNAUTHENTICATED`. Un token de acceso vencido responde `TOKEN_EXPIRED`: es la señal para que la app refresque.

**Cambiar contraseña** `POST /v1/auth/change-password` con `{ "currentPassword", "newPassword" }` (8 a 128 caracteres, distinta de la actual): apaga `mustChangePassword`, cierra las demás sesiones y devuelve un par de tokens nuevo. Mientras `mustChangePassword` sea verdadero, la cuenta solo puede llamar a este endpoint y a `/v1/auth/logout` (lo demás responde `PASSWORD_CHANGE_REQUIRED`).

**Salir** `POST /v1/auth/logout` con `{ "refreshToken" }`: revoca ese token; responde 204.

**Cuentas (solo SA).** `GET /v1/accounts` devuelve `accounts` (usuario, cargo, persona, manzana y `status`: `active`, `locked`, `disabled`, `must_change_password`, `role_not_active`) y `assignmentsWithoutAccount`. `POST /v1/accounts` con `{ roleAssignmentId, username }` devuelve `temporaryPassword` **una sola vez**. Restablecer genera otra contraseña temporal y cierra las sesiones; acepta `{ reason }` opcional (la app lo pide) y también funciona sin cuerpo. Bloquear (indefinido hasta desbloquear), desbloquear y desactivar piden `reason`. Todo queda en la bitácora técnica. El SA no puede bloquear ni desactivar su propia cuenta.

## Detalle: estado de cuenta

`GET /v1/units/{id}/account-statement` (comité; JM solo de su manzana): calcula al consultar con la función pura de `packages/shared` (ver [decisiones.md](decisiones.md#cálculo-del-estado-de-cuenta-d-01-d-02-d-06-d-25)). Devuelve `statement` con `currentPeriod`, cada mes en `months` con `period`, `status` (`pending`, `overdue`, `paid`, `advance`), `baseAmount`, `surcharge` y `total` (centavos; los pagados con su tarifa y recargo fijos), un resumen `summary` (`overdueCount`, `pendingCount`, `inDebtCycle`, `overdueTotal`, `pendingTotal`, `surchargeTotal`, `totalDue`, `advanceCount`) y `missingRatePeriods`.

La búsqueda, la ficha de persona y la ficha de toma incluyen el adeudo de cada unidad (`debt`: `totalDue`, `overdueCount`, `inDebtCycle`) y el total de la persona o de la toma. Un JM nunca recibe importes de unidades de otra manzana.

## Detalle: padrón y tomas

- **Búsqueda** (`/v1/search?q=`, mínimo 2 caracteres): `people` por nombre sin acentos y tolerante a errores (`f_normalize_name` + pg_trgm), por distintivo o folio; `connections` por folio o dirección; `units` por folio o referencia. Hasta 20 por grupo. Cada unidad incluye su adeudo.
- **Lo que ve un JM** (RF-PAD-04, HU-13): tomas, unidades, solicitudes y pagos solo de su manzana (fuera de ella, `OUT_OF_SCOPE`; en la búsqueda no aparecen). De una persona ve solo nombre, distintivo y folio, salvo que (a) sea titular vigente de una unidad de su manzana, (b) tenga una solicitud no rechazada ni cancelada en su manzana, o (c) él mismo la haya registrado y aún no tenga unidad ni solicitud. Aun así, sus unidades de otras manzanas aparecen solo como "otra manzana", sin folio, importes ni dirección.
- **Personas**: `POST /v1/people` con `{ givenNames, paternalSurname, maternalSurname?, distinguishingNote?, phone?, registeredOn? }`. `/v1/people/matches` devuelve los homónimos exactos (`exact`) y los nombres parecidos (`similar`). Con homónimo y sin distintivo → `HOMONYM_WITHOUT_NOTE` (con los homónimos en `details`); nombre + distintivo repetido → `DUPLICATE_DISTINGUISHING_NOTE` (D-10).
- **Tomas preexistentes** (`/v1/connections/pre-existing`): `{ address, blockId, activatedOn?, unit: { holderPersonId, reference?, registeredOn?, billingStartPeriod } }`; `billingStartPeriod` es el primer mes pendiente de la libreta (D-18).
- **Unidades** (`POST /v1/units`): `{ connectionId, holderPersonId, reference?, registeredOn?, billingStartPeriod? }`, familia en una toma **activa**, sin cargo de apertura (`CONNECTION_NOT_ACTIVE` si está suspendida o dada de baja). Se cobra desde el mes de registro o desde el periodo indicado. La ficha incluye titular e historial, suspensiones, pagos registrados y la solicitud de cambio pendiente (`pendingChange`).
- **Baja y cambio de titular**: `{ reason }` y `{ newHolderId, reason }`; crean una autorización; una unidad solo tiene una solicitud pendiente. Al autorizarse, la baja fija `deactivatedOn` = hoy; el cambio de titular cierra el titular actual y abre el nuevo desde hoy. El adeudo se queda en la unidad (D-11).
- **Suspensiones**: `{ connectionId? | unitId?, periodFrom, reason, agreementId }`, de una toma o de una unidad (exactamente una), con acuerdo aprobado; sin traslapes; se terminan con `{ periodTo }`, el último mes sin cobro (D-06). **Lista** (`GET /v1/suspensions`, comité; S-08): `status=active` (por omisión: sin fin, o terminan en el mes en curso o después), `ended` (terminaron antes del mes en curso) o `all`; filtros `connectionId` (la toma y sus unidades) y `unitId`; paginada, de la más reciente a la más antigua. Cada una trae `target` (`connection` o `unit`), el acuerdo (`id`, `folio`), la toma (`folio`, `address`, `blockCode`, `unitCount`) y, si es de una unidad, `unit` con su titular vigente (`holderName`). El JM ve las suspendidas de su manzana en el reporte por manzana.
- **Solicitudes de toma**: alta con `{ applicantId, address, blockId, requestedOn? }`. Resolver con `{ agreementId, resolutionReason? }`: con acuerdo aprobado genera el cargo de apertura con el importe vigente ese día, que queda fijo (D-13; `FEE_WITHOUT_AMOUNT` si no hay importe); con acuerdo de rechazo el motivo es obligatorio. Activar (`{ activatedOn?, address?, reference? }`) exige la apertura pagada (`OPENING_NOT_PAID`) y crea la toma y su primera unidad con el solicitante como titular, cobrando desde el mes de activación. **Cancelar** (D-12) con `{ reason }`: SEC o el JM de la manzana; solo en Solicitada o Aprobada pendiente de pago; si estaba aprobada, cancela también el cargo de apertura; con la apertura pagada → `INVALID_STATE`.
- **Acuerdos**: `{ meetingDate, topic, result: approved_by_majority | rejected, votesFor?, votesAgainst?, abstentions?, minutesReference?, correctsId? }`.

## Detalle: organización y autorizaciones

- **Secciones y manzanas.** SEC las crea (`{ code, name }`; manzana con `sectionId`) y edita (`name`, `active`); el resto del comité y los jefes las consultan. La clave (`code`) no cambia después de creada; con la sección forma el código visible `fullCode` (S1-M03). No se crean manzanas en una sección inactiva ni se asignan jefes a una manzana inactiva. La manzana incluye a su **jefe vigente** (`leader`); su teléfono solo lo ven el comité y el propio jefe (RF-ORG-06).
- **Asignaciones.** SEC registra la asignación y se crea una autorización pendiente para PRE. Una solicitud pendiente ya ocupa el lugar: un jefe por manzana y una manzana por jefe (`LEADER_ALREADY_ASSIGNED`), y un solo presidente, tesorero y secretario (`ROLE_ALREADY_ASSIGNED`). Al **rechazarse**, la asignación se cierra con `end_date = start_date` y libera la manzana o el cargo. Estado calculado (`status`): pendiente, rechazada, programada, vigente o cerrada.
- **Cerrar** (`/v1/role-assignments/{id}/close`, SEC, con `endDate` no posterior a hoy y `reason`): fin de periodo de un cargo del comité; en la misma transacción desactiva su cuenta y cierra sus sesiones (D-22). Un jefe de manzana no se cierra: se sustituye con acta de entrega (D-08, paso 8 de la API).
- **Autorizaciones.** `GET /v1/approvals?status=pending|resolved|all`: PRE ve todas; cada cargo ve las que pidió. Cada una trae `description` (el texto que escribe su módulo) y `subject` `{ type, id }`, el registro del que trata, para abrirlo: `role_assignment` (asignación), `rate` (tarifa), `plumber` (fontanero del salario), `cashbox` (saldo inicial), `unit` (baja y cambio de titular), `payment` (cancelación), `handover` o `closing` (aclaración) y `expense` (reintegro). `GET /v1/approvals/{id}` da una sola con las mismas reglas: la de otro solicitante responde `NOT_FOUND`, sin revelar que existe. `POST /v1/approvals/{id}/resolve` con `{ result: approved | rejected, reason? }`: solo PRE; motivo obligatorio al rechazar; `APPROVAL_ALREADY_RESOLVED` si ya se resolvió. Cada módulo registra qué pasa al autorizar o rechazar una solicitud de su tipo; la resolución, ese efecto y la bitácora van en una sola transacción.

## Detalle: cajas

- **Mi caja** (`/v1/cashboxes/mine`, RF-CAJ-07): la del cargo de la cuenta (JM → su manzana, TES → comité, PRE → apoyo) con `balance` esperado, `collected` (pagos menos cancelaciones), `handedOver` (lo recibido por TES), `pendingHandover`, `available` (saldo − pendiente) y su `openingBalance`. La caja de apoyo puede no existir aún (se crea con el primer cobro): se devuelve sin id y en ceros. SEC y VOC no custodian efectivo (`FORBIDDEN`). Cada manzana nueva nace con su caja.
- **Movimientos** (`/v1/cashboxes/{id}/movements?from=&to=`): de `v_cashbox_movement`, del más reciente al más antiguo, paginados. Comité: todas; JM: solo la de su manzana (`OUT_OF_SCOPE`).
- **Saldo inicial** (`/v1/cashboxes/{id}/opening-balance`, D-18): TES con `{ amount, date, reason }` (fecha no futura) e `Idempotency-Key`; crea una autorización para PRE. Una sola solicitud pendiente o autorizada por caja (`INVALID_STATE`); una rechazada la libera.
- **Entregas** (D-16): JM o PRE preparan `{ declaredAmount, notes? }` desde su caja, nunca más que el disponible (saldo − entregas pendientes, `INSUFFICIENT_BALANCE`). Quien la preparó la retira mientras esté pendiente. TES confirma `{ receivedAmount }` (0 a lo declarado): la caja de origen baja solo lo recibido y la caja del comité sube lo mismo; el faltante se queda en la caja de origen. El folio `EN-` es el de la constancia. JM y PRE ven las de su caja; TES y VOC todas.
- **Aclaraciones** (`/v1/adjustments`, RF-CAJ-06): TES propone `{ handoverId, amount (con signo), reason }` sobre una entrega confirmada con diferencia, una pendiente a la vez; al autorizarla PRE se mueve la caja de origen (p. ej. `-5000` da de baja un faltante). Las aclaraciones de corte llevan `closingId` en lugar de `handoverId` (ver cortes).

## Detalle: comité

- **Ingresos**: TES registra `{ concept, amount, date?, voucherReference? }` (fecha no futura) en la caja del comité.
- **Gastos** (D-17, D-21): TES registra `{ categoryId, description, amount, agreementId, voucherReference? }` con acuerdo aprobado; quedan pendientes de pago. Pagar bloquea la caja del comité y exige saldo suficiente (`INSUFFICIENT_BALANCE`). Rechazar pide `{ reason }` y solo aplica a pendientes. El reintegro (`{ reason }`) de un gasto pagado crea una autorización; al autorizarla el importe vuelve a la caja. Un reintegro pendiente o autorizado por gasto; uno rechazado lo libera.
- **Fontanero** (D-24): TES lo registra (`{ name, phone? }`) y edita su `phone` (auditado por la base) y `active`. El salario `{ amount, frequency: weekly | biweekly | monthly, effectiveFrom, agreementId, reason? }` lo autoriza PRE; una solicitud pendiente a la vez. El pago `{ date? }` (hoy por omisión, nunca futura) cubre el periodo que contiene esa fecha según la periodicidad del salario vigente: semanal de lunes a domingo, quincenal del 1 al 15 y del 16 al último día, mensual el mes natural. El importe es el salario autorizado vigente al inicio del periodo; se registra como gasto pagado de la categoría *Salario del fontanero*, con saldo suficiente, y un periodo se paga una sola vez (`PERIOD_ALREADY_PAID`).

## Detalle: cortes

- **Abrir** (`/v1/closings`, JM o TES): `{ type: monthly | extraordinary, period?, cashboxId? }`. JM corta la caja de su manzana; TES la del comité por omisión o cualquier caja con `cashboxId`. **Mensual**: solo de un mes ya terminado (`VALIDATION_ERROR`), uno por caja y mes (`INVALID_STATE`). **Extraordinario**: del día 1 del mes en curso a hoy (acta de entrega, D-08); no bloquea periodos. Las cifras (`figures`) salen de `v_closing`: `startingBalance`, `openingBalances`, `payments`, `cancellations`, `handoversOut`, `handoversIn`, `incomes`, `expenses`, `refunds`, `adjustments` y `expectedBalance`.
- **Conteo** (`/v1/closings/{id}/count`): `{ countedCash, notes? }`; solo quien lo preparó y hasta que se revise. Con diferencia, las observaciones son obligatorias.
- **Revisar y cerrar** (PRE o VOC): revisar exige el conteo; cerrar exige la revisión. Un corte mensual solo se cierra si el del mes anterior de la caja ya está cerrado (o la caja no tiene movimientos antes), así sus cifras ya no cambian. Al cerrarlo, el mes queda bloqueado (D-14, `PERIOD_CLOSED`), y también cualquier fecha anterior en movimientos con fecha elegida (ingresos y saldos iniciales).
- **Aclaraciones de corte** (`/v1/adjustments` con `closingId`): sobre un corte revisado o cerrado con diferencia, con fecha de hoy (periodo abierto, D-14) y autorización de PRE.
- **Sustitución de jefe** (`/v1/blocks/{id}/leader-substitution`, SEC, D-08): `{ closingId, personId, contactPhone, startDate, reason }`. Exige un jefe vigente y un corte **extraordinario** de la caja de esa manzana, contado y sin movimientos de la caja después de su fecha; el nuevo jefe empieza en o después de esa fecha. En una transacción cierra la asignación saliente (`outgoing`, con `endDate = startDate`), desactiva su cuenta y registra al nuevo jefe (`incoming`) pendiente de autorización de PRE. La caja sigue con la manzana y su saldo.

## Detalle: reportes y bitácora

- **Rango**: `?from=AAAA-MM&to=AAAA-MM` (por omisión el mes actual). Lo recaudado, entregado, ingresos y gastos se filtran por el rango con los mismos movimientos que los cortes, así que cuadran con ellos; el adeudo es el estado de cuenta a la fecha de consulta (`debtAsOf`, D-25).
- **Padrón por manzana** (`/v1/reports/block?blockId=`, JM de su manzana, comité): encabezado (sección, manzana, jefe y teléfono); tomas con sus unidades (titular con distintivo, fechas, estado, pagos del rango con folio de papel, `debtMonths` con base, recargo y total, `advances`); resumen de la caja (saldo inicial, recaudado por mensualidades y cargos, cancelaciones, entregas confirmadas y pendientes, saldo esperado, último corte y su diferencia) y totales.
- **Comunitario** (`/v1/reports/community`, comité): por sección y manzana (unidades activas, recaudado de las unidades de la manzana en cualquier caja, adeudo, anticipos, entregado y efectivo con el jefe); cajas de apoyo; caja del comité (saldo inicial, cobros directos, entregas recibidas, ingresos, gastos por categoría, reintegros, aclaraciones, saldo); totales por separado: recaudado, `cashWithLeader`, `cashInSupport`, caja del comité, `expectedCommunityFunds` (suma de todas las cajas), adeudo, anticipos y `closingDifferences`.
- **Bitácora** (`/v1/audit-log?userAccountId=&tableName=&recordId=&action=&from=&to=`): PRE ve todo; SA solo los registros técnicos (`isTechnical`). Paginada, del más reciente al más antiguo.

## Ejemplo: registrar pago

`POST /v1/payments` con `Idempotency-Key`:

```json
{
  "unitId": 45,
  "periods": ["2026-06", "2026-07"],
  "extraChargeIds": [],
  "paperFolio": "001234",
  "expectedTotal": 20000
}
```

Respuesta 201:

```json
{
  "payment": {
    "id": 981,
    "folio": "PG-202610-000981",
    "unit": { "id": 45, "folio": "U-000045", "holder": "Juan Pérez López" },
    "blockId": 3,
    "months": [
      { "period": "2026-06", "baseAmount": 5000, "surcharge": 5000, "total": 10000 },
      { "period": "2026-07", "baseAmount": 5000, "surcharge": 5000, "total": 10000 }
    ],
    "charges": [],
    "total": 20000,
    "cashbox": { "id": 7, "type": "block", "label": "S1-M03" },
    "paperFolio": "001234",
    "receipts": [
      { "id": 1201, "paperFolio": "001234", "type": "original", "issuedAt": "2026-10-25T18:30:00Z" }
    ],
    "occurredAt": "2026-10-25T18:30:00Z",
    "capturedBy": { "userAccountId": 12, "username": "jefe1" },
    "cancelled": false,
    "cancellations": []
  }
}
```

Si el total recalculado no coincide con `expectedTotal` → 409 `TOTAL_CHANGED` con el nuevo resumen en `details` (`total`, `expectedTotal`). Si la misma `Idempotency-Key` llega otra vez → se devuelve el pago ya registrado.

## Detalle: tarifas y conceptos

- **Tarifas** (`/v1/rates`): TES registra `{ effectivePeriod, amount, approvedOn, agreementId, reason? }` con un acuerdo aprobado por mayoría y se crea una autorización para PRE (D-20). La vigencia debe ser **posterior al mes actual** (D-05); la única excepción es capturar la historia al arranque (D-18): se acepta un mes pasado solo si es anterior a la tarifa autorizada más antigua, o cualquier mes mientras no haya ninguna autorizada. Si no → `INVALID_RATE_EFFECTIVE_PERIOD`. Un periodo con una tarifa pendiente o autorizada no acepta otra (`INVALID_STATE`); una rechazada lo libera. Solo las autorizadas ponen precio a los meses. `GET /v1/rates` devuelve el historial con su estado.
- **Conceptos** (`/v1/fees`): TES crea conceptos (`{ type, name }`; nombre único, `DUPLICATE_CODE`) y les agrega importes con `POST /v1/fees/{id}/amounts` `{ effectiveFrom, amount }`: desde hoy o después, nunca hacia atrás. Un cargo no guarda importe (es el vigente en su fecha), así que se rechaza un importe nuevo si ya hay cargos de ese concepto con esa fecha o posterior (`INVALID_STATE`). La consulta incluye el importe vigente (`currentAmount`) y el historial (`amounts`).

## Detalle: cobranza

- **Previsualizar y registrar** (`/v1/payments/preview`, `/v1/payments`): `{ unitId?, periods, extraChargeIds, paperFolio, expectedTotal }` (los dos últimos solo al registrar). Hay que elegir al menos un mes o un cargo; los meses exigen la unidad. El servidor recalcula con la función del estado de cuenta: `MONTH_ORDER` (desde el más antiguo, sin huecos, anticipos solo liquidando todo), `PERIOD_ALREADY_PAID`, y `VALIDATION_ERROR` para meses no cobrables o sin tarifa. Los meses vencidos llevan recargo si el ciclo de adeudo está abierto; el pendiente y los anticipos nunca, y cada anticipo usa la tarifa de su mes.
- **Cargos extraordinarios**: vigentes y sin pagar en un pago vigente. Con unidad, los de esa unidad o de su toma; sin unidad, solo la apertura de una solicitud aprobada pendiente de pago. Al pagarla la solicitud pasa a pendiente de instalación y ya se puede activar.
- **Crear un cargo extraordinario** (`POST /v1/extra-charges`, D-28): solo TES, con `{ feeId, unitId | connectionId, chargedOn? }` (exactamente uno de los dos destinos). `chargedOn` es hoy si se omite y nunca una fecha futura. El concepto debe ser reinstalación, reparación u otro (la apertura se cobra con su solicitud → `VALIDATION_ERROR`) y tener importe vigente en esa fecha (`FEE_WITHOUT_AMOUNT`); ese importe queda fijo para el cargo (D-13). Una unidad o toma dada de baja → `INVALID_STATE`; una suspendida sí se puede cargar (la reinstalación existe para eso). No mueve dinero, así que no lleva `Idempotency-Key`; se escribe en la bitácora. Responde `201 { charge }` con `{ id, fee { id, type, name }, amount, chargedOn, target (unit | connection), unitId, connectionId, status (pending | paid | cancelled), paymentId, cancelledOn, cancellationReason }`.
- **Cargos de una familia** (`GET /v1/units/{id}/extra-charges?status=pending|all`): los que la familia puede pagar, los de la unidad y los de su toma, sin la apertura. `pending` (por omisión) deja fuera los cancelados y los pagados en un pago vigente. JM solo de su manzana (`OUT_OF_SCOPE`). F-02 los muestra para cobrarlos en el mismo pago que los meses (`extraChargeIds`).
- **Cancelar un cargo** (`POST /v1/extra-charges/{id}/cancel`, D-28): solo TES, `{ reason }` obligatorio, sin autorización del presidente; queda en la bitácora con su motivo y el cargo no se borra (`cancelledOn`, `cancellationReason`). Uno pagado se corrige cancelando el pago (`INVALID_STATE`, `status: paid`); uno ya cancelado → `INVALID_STATE`; la apertura se cancela con su solicitud.
- **Registro**: en una transacción con la `Idempotency-Key`, la unidad bloqueada (`FOR UPDATE`), la caja bloqueada y la bitácora; guarda el pago, sus meses con tarifa y recargo fijos (D-25), los meses cubiertos, los cargos y el recibo de papel original. Dos cobros simultáneos del mismo mes: uno entra y el otro recibe `PERIOD_ALREADY_PAID`.
- **Caja receptora** (D-07): la del cargo de la cuenta. JM → caja de su manzana (se crea con el primer cobro si la manzana no tiene); TES → caja del comité; PRE → su caja de apoyo, que se crea con su primer cobro. La manzana atendida es la de la unidad (o la de la solicitud).
- **Alcance**: un JM solo cobra, consulta y repone en su manzana (`OUT_OF_SCOPE`). `GET /v1/payments` filtra por `unitId`, `blockId` y fechas `from`/`to`, paginado; el detalle incluye meses, cargos, recibos de papel y cancelaciones.
- **Reposición** (`/v1/payments/{id}/replacements`, D-23): `{ paperFolio }`, sin costo ni movimiento de caja, en el talonario de la caja del pago (`DUPLICATE_PAPER_FOLIO`). No aplica a un pago cancelado.
- **Cancelación** (`/v1/payments/{id}/request-cancellation`, D-15): `{ reason }` con `Idempotency-Key`; crea una autorización para PRE. Una sola pendiente por pago; no aplica a un pago ya cancelado. Al autorizarse se borran sus meses cubiertos (vuelven a pendiente o vencido), el contramovimiento aparece en la caja receptora y sus cargos se reemiten con la misma fecha (mismo importe) para poder cobrarse otra vez. No se puede cancelar un pago que liquidó la apertura de una toma ya instalada (`INVALID_STATE`), ni autorizarla en un mes con corte cerrado (`PERIOD_CLOSED`).

## Códigos de error

| Código                          | HTTP | Cuándo                                                   |
| ------------------------------- | ---- | -------------------------------------------------------- |
| INVALID_CREDENTIALS             | 401  | Usuario o contraseña incorrectos                         |
| ACCOUNT_LOCKED                  | 401  | Por intentos fallidos o por el SA                        |
| ROLE_NOT_ACTIVE                 | 403  | La asignación de la cuenta ya se cerró                   |
| OUT_OF_SCOPE                    | 403  | Recurso de otra manzana                                  |
| ASSIGNMENT_HAS_ACCOUNT          | 409  | La asignación ya tiene cuenta                            |
| ASSIGNMENT_NOT_ACTIVE           | 422  | Se pidió una cuenta para una asignación pendiente, rechazada, cerrada o aún sin iniciar |
| USERNAME_TAKEN                  | 409  | El nombre de usuario ya existe                           |
| HOMONYM_WITHOUT_NOTE            | 422  | Mismo nombre sin distintivo                              |
| DUPLICATE_DISTINGUISHING_NOTE   | 409  | Nombre + distintivo ya existe                            |
| MONTH_ORDER                     | 422  | No se eligió desde el más antiguo o hay huecos           |
| PERIOD_ALREADY_PAID             | 409  | Algún mes ya está cubierto                               |
| TOTAL_CHANGED                   | 409  | El total recalculado no coincide                         |
| DUPLICATE_PAPER_FOLIO           | 409  | Folio ya usado en esa caja                               |
| PERIOD_CLOSED                   | 409  | Fecha dentro de un mes con corte cerrado                 |
| INSUFFICIENT_BALANCE            | 422  | Entrega o gasto mayor al saldo esperado                  |
| CONNECTION_NOT_ACTIVE           | 422  | Agregar familia a toma no activa                         |
| FEE_WITHOUT_AMOUNT              | 422  | El concepto (apertura o cargo extraordinario) no tiene importe vigente en la fecha del cargo |
| OPENING_NOT_PAID                | 422  | Activar una toma con la cuota de apertura sin pagar      |
| INVALID_STATE                   | 409  | La operación no corresponde al estado actual del registro; solo si no hay un código más específico (`APPROVAL_ALREADY_RESOLVED`, `CONNECTION_NOT_ACTIVE`…). `details`: `status` actual y `action` intentada |
| LEADER_ALREADY_ASSIGNED         | 409  | La manzana ya tiene jefe o la persona ya es jefe de otra |
| ROLE_ALREADY_ASSIGNED           | 409  | Ya hay presidente, tesorero o secretario abierto (vigente o pendiente) |
| DUPLICATE_CODE                  | 409  | Clave o nombre de sección, o clave de manzana, ya registrado |
| INVALID_RATE_EFFECTIVE_PERIOD   | 422  | Vigencia no posterior al mes actual                      |
| APPROVAL_ALREADY_RESOLVED       | 409  | La solicitud ya fue resuelta                             |

### Códigos generales

Los usa cualquier endpoint; no dependen de una regla de negocio.

| Código                          | HTTP | Cuándo                                                                                   |
| ------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| VALIDATION_ERROR                | 400  | La validación Zod falló; `details.issues` lista cada campo (`path`) con su `message`     |
| INVALID_REQUEST                 | 400  | El cuerpo no es JSON válido o la solicitud está mal formada                              |
| IDEMPOTENCY_KEY_REQUIRED        | 400  | Falta `Idempotency-Key` o no es un UUID en un POST que mueve dinero                      |
| UNAUTHENTICATED                 | 401  | Sin token de acceso o token inválido                                                     |
| TOKEN_EXPIRED                   | 401  | El token de acceso venció; la app debe refrescarlo                                       |
| ACCOUNT_DISABLED                | 401  | La cuenta fue desactivada por el SA o al cerrarse su asignación                          |
| PASSWORD_CHANGE_REQUIRED        | 403  | La cuenta debe cambiar su contraseña antes de usar otros endpoints                       |
| FORBIDDEN                       | 403  | El cargo de la cuenta no puede hacer esa operación                                       |
| NOT_FOUND                       | 404  | La ruta o el recurso no existe                                                           |
| IDEMPOTENCY_KEY_REUSED          | 409  | La `Idempotency-Key` ya se usó en otra operación o por otra cuenta                       |
| TOO_MANY_REQUESTS               | 429  | Se superó el límite de solicitudes                                                       |
| INTERNAL_ERROR                  | 500  | Error inesperado; el detalle queda solo en el registro del servidor                      |
| DATABASE_UNAVAILABLE            | 503  | La base de datos no responde (también lo usa `/health`)                                  |

La app móvil agrega dos códigos propios que la API nunca devuelve: `NETWORK_ERROR` (sin respuesta) e `INVALID_RESPONSE` (respuesta que no cumple el esquema); ver [glosario.md](glosario.md#códigos-de-error).

Una cuenta se valida contra la base en **cada** solicitud autenticada (desactivación, bloqueo y vigencia de la asignación), no solo en las operaciones de dinero: un bloqueo surte efecto de inmediato. Si la misma `Idempotency-Key` llega otra vez de la misma cuenta y a la misma ruta, se devuelve la respuesta guardada con el encabezado `Idempotent-Replayed: true`; las claves se guardan 24 h.
