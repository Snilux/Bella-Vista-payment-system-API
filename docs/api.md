# Contrato de la API

Fuente: documento 2.3 de Notion. Los esquemas de entrada y salida se definen con Zod en `packages/shared/src/schemas` y los usan la API y la app.

> Rutas, campos JSON y códigos de error se describen aquí en español; en el código van en inglés según [glosario.md](glosario.md) (por ejemplo `/cortes/{id}/cerrar` → `/closings/{id}/close`, `codigo` → `code`, `PERIODO_YA_PAGADO` → `PERIOD_ALREADY_PAID`). Los mensajes (`message`) siguen en español.

## Convenciones

| Tema          | Regla                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base          | `/v1`, solo HTTPS en producción, JSON UTF-8                                                                                                                  |
| Autenticación | `Authorization: Bearer <token de acceso>` en todo excepto login y refresco                                                                                   |
| Idempotencia  | `Idempotency-Key: <uuid>` obligatorio en los POST que mueven dinero (pagos, cancelaciones, entregas, gastos, ingresos, pagos al fontanero, saldos iniciales) |
| Dinero        | Enteros en centavos (`5000` = $50.00)                                                                                                                        |
| Periodos      | `AAAA-MM`                                                                                                                                                    |
| Fechas        | ISO 8601                                                                                                                                                     |
| Paginación    | `?limite=20&cursor=...` → `{ datos: [], siguiente: "cursor" }`                                                                                               |
| Alcance       | La API filtra por manzana según el cargo de la cuenta; un JM nunca recibe datos de pago de otras manzanas                                                    |
| Errores       | `{ "error": { "codigo": "PERIODO_YA_PAGADO", "mensaje": "Junio 2026 ya está pagado.", "detalles": {} } }`                                                    |

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

### Sesión y cuentas (no hay registro público)

| Método | Ruta                                              | Descripción                                                                                            | Roles             |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------- |
| POST   | /auth/login                                       | Usuario y contraseña; devuelve tokens, el cargo de la cuenta y si debe cambiar la contraseña           | Público           |
| POST   | /auth/refrescar                                   | Rota el token de refresco                                                                              | Público con token |
| POST   | /auth/cambiar-contrasena                          | Obligatorio si debe_cambiar_contrasena                                                                 | Todos             |
| POST   | /auth/salir                                       | Revoca el token de refresco                                                                            | Todos             |
| GET    | /cuentas                                          | Cuentas y asignaciones vigentes sin cuenta                                                             | SA                |
| POST   | /cuentas                                          | Crea la cuenta de una asignación (el cargo sale de ella); devuelve la contraseña temporal una sola vez | SA                |
| POST   | /cuentas/{id}/restablecer                         | Contraseña temporal y cierre de sesiones                                                               | SA                |
| POST   | /cuentas/{id}/bloquear, /desbloquear, /desactivar | Estado de la cuenta                                                                                    | SA                |

### Organización

| Método           | Ruta                            | Descripción                             | Roles                |
| ---------------- | ------------------------------- | --------------------------------------- | -------------------- |
| GET, POST, PATCH | /secciones                      | Catálogo                                | SEC (consulta todos) |
| GET, POST, PATCH | /manzanas                       | Catálogo; GET incluye jefe vigente      | SEC (consulta todos) |
| GET              | /asignaciones                   | Cargos vigentes e históricos            | Comité               |
| POST             | /asignaciones                   | Registra asignación (crea autorización) | SEC                  |
| POST             | /asignaciones/{id}/cerrar       | Fin de periodo de un cargo del comité (desactiva su cuenta) | SEC |
| POST             | /manzanas/{id}/sustitucion-jefe | Sustitución con corte extraordinario (paso 8 de la API) | SEC          |

### Padrón y tomas

| Método    | Ruta                                     | Descripción                                                            | Roles                 |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| GET       | /buscar?q=                               | Búsqueda de personas, tomas y unidades                                 | JM, comité            |
| GET       | /personas/coincidencias?nombres=&ap=&am= | Homónimos antes de crear                                               | JM, SEC               |
| POST      | /personas                                | Crea persona (exige distintivo si hay homónimo)                        | JM, SEC               |
| GET       | /personas/{id}                           | Ficha con unidades según alcance                                       | Según alcance         |
| POST      | /tomas/preexistentes                     | Toma capturada al arranque                                             | JM, SEC               |
| GET       | /tomas/{id}                              | Ficha con sus unidades                                                 | Según alcance         |
| POST      | /unidades                                | Crea unidad (en toma existente o al arranque con periodo_inicio_cobro) | JM, SEC               |
| GET       | /unidades/{id}                           | Ficha                                                                  | Según alcance         |
| GET       | /unidades/{id}/estado-cuenta             | Meses con base, recargo, total y estado                                | Según alcance         |
| POST      | /unidades/{id}/solicitar-baja            | Crea autorización                                                      | JM, SEC               |
| POST      | /unidades/{id}/solicitar-cambio-titular  | Crea autorización                                                      | JM, SEC               |
| POST      | /suspensiones                            | Suspende toma o unidad                                                 | SEC, PRE              |
| POST      | /suspensiones/{id}/terminar              | Reactiva                                                               | SEC, PRE              |
| GET, POST | /solicitudes-toma                        | Lista y registro                                                       | JM (su manzana), SEC  |
| POST      | /solicitudes-toma/{id}/resolver          | Aprobar o rechazar con acuerdo                                         | SEC                   |
| POST      | /solicitudes-toma/{id}/activar           | Instalación y primera unidad                                           | JM, SEC               |
| GET, POST | /acuerdos                                | Acuerdos de junta                                                      | SEC (consulta comité) |

### Tarifas y conceptos

| Método    | Ruta       | Descripción                         | Roles                |
| --------- | ---------- | ----------------------------------- | -------------------- |
| GET       | /tarifas   | Historial                           | Todos                |
| POST      | /tarifas   | Registra tarifa (crea autorización) | TES                  |
| GET, POST | /conceptos | Conceptos e importes                | TES (consulta todos) |

### Cobranza

| Método | Ruta                                  | Descripción                  | Roles                |
| ------ | ------------------------------------- | ---------------------------- | -------------------- |
| POST   | /pagos/previsualizar                  | Calcula el total sin guardar | JM, TES, PRE         |
| POST   | /pagos                                | Registra pago                | JM, TES, PRE         |
| GET    | /pagos?unidad=&manzana=&desde=&hasta= | Lista                        | Según alcance        |
| GET    | /pagos/{id}                           | Detalle con recibos de papel | Según alcance        |
| POST   | /pagos/{id}/reposiciones              | Reposición de recibo         | JM (su manzana), TES |
| POST   | /pagos/{id}/solicitar-cancelacion     | Crea autorización            | JM, TES              |

### Cajas

| Método    | Ruta                      | Descripción                                     | Roles                             |
| --------- | ------------------------- | ----------------------------------------------- | --------------------------------- |
| GET       | /cajas/mia                | Caja del cargo de la cuenta con saldo y resumen | JM, TES, PRE (apoyo)              |
| GET       | /cajas/{id}/movimientos   | Movimientos                                     | Custodio, comité                  |
| POST      | /cajas/{id}/saldo-inicial | Saldo inicial (crea autorización)               | TES                               |
| GET, POST | /entregas                 | Lista y preparación                             | JM, PRE (prepara), TES (consulta) |
| POST      | /entregas/{id}/retirar    | Retira entrega pendiente                        | Quien la preparó                  |
| POST      | /entregas/{id}/confirmar  | Captura importe recibido                        | TES                               |
| POST      | /aclaraciones             | Propone aclaración (crea autorización)          | TES                               |

### Comité

| Método           | Ruta                             | Descripción                            | Roles                 |
| ---------------- | -------------------------------- | -------------------------------------- | --------------------- |
| GET, POST        | /ingresos                        | Otros ingresos                         | TES (consulta comité) |
| GET, POST        | /gastos                          | Gastos                                 | TES (consulta comité) |
| POST             | /gastos/{id}/pagar               | Marca pagado y descuenta caja          | TES                   |
| POST             | /gastos/{id}/rechazar            | Rechaza gasto pendiente                | TES                   |
| POST             | /gastos/{id}/solicitar-reintegro | Crea autorización                      | TES                   |
| GET, POST, PATCH | /fontaneros                      | Fontanero                              | TES                   |
| POST             | /fontaneros/{id}/salarios        | Nuevo salario (crea autorización)      | TES                   |
| POST             | /fontaneros/{id}/pagos           | Paga un periodo con el salario vigente | TES                   |

### Cortes, autorizaciones, reportes y bitácora

| Método | Ruta                                            | Descripción                                  | Roles                              |
| ------ | ----------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| GET    | /cortes?caja=&periodo=                          | Lista                                        | Según alcance                      |
| POST   | /cortes                                         | Abre corte (calcula cifras)                  | JM, TES                            |
| POST   | /cortes/{id}/conteo                             | Efectivo contado y observaciones             | Quien lo prepara                   |
| POST   | /cortes/{id}/revisar                            | Marca revisado                               | PRE, VOC                           |
| POST   | /cortes/{id}/cerrar                             | Cierra y bloquea el periodo                  | PRE, VOC                           |
| GET    | /autorizaciones?estado=pendiente                | Bandeja                                      | PRE (y cada solicitante las suyas) |
| POST   | /autorizaciones/{id}/resolver                   | Autoriza o rechaza con motivo                | PRE                                |
| GET    | /reportes/padron-manzana?manzana=&desde=&hasta= | Datos del reporte por manzana                | JM (su manzana), comité            |
| GET    | /reportes/comunitario?desde=&hasta=             | Datos del reporte comunitario                | Comité                             |
| GET    | /bitacora                                       | Filtros por usuario, entidad, acción y fecha | PRE, SA (técnica)                  |

Los reportes devuelven JSON; la app genera el PDF.

## Detalle: sesión y cuentas

**Login** `POST /v1/auth/login` con `{ "usuario": "tesorero", "contrasena": "..." }`. Respuesta 200:

```json
{
  "tokenAcceso": "eyJ...",
  "tokenAccesoExpiraEn": 900,
  "tokenRefresco": "q3Vx...",
  "cuenta": { "usuario": "tesorero", "cargo": "tesorero", "manzanaId": null, "debeCambiarContrasena": false }
}
```

- El token de acceso dura 15 min y lleva la cuenta, el usuario, el cargo y la manzana. El de refresco dura 30 días y solo se guarda su hash (SHA-256).
- Usuario inexistente o contraseña incorrecta → `CREDENCIALES_INVALIDAS`. Al quinto intento fallido seguido la cuenta se bloquea 15 min (`CUENTA_BLOQUEADA`, con `detalles.bloqueadaHasta`). Mientras esté bloqueada no se revisa la contraseña.
- Con la contraseña correcta: cuenta desactivada → `CUENTA_DESACTIVADA`; asignación cerrada, pendiente o sin iniciar → `CARGO_NO_VIGENTE`.
- Límite: 10 solicitudes por minuto por IP en login y refresco (`DEMASIADAS_SOLICITUDES`).

**Refresco** `POST /v1/auth/refrescar` con `{ "tokenRefresco": "..." }`: revoca el token recibido y entrega un par nuevo. Si llega un token que ya fue rotado o revocado, se revoca **toda su cadena** (detección de robo) y responde `NO_AUTENTICADO`.

**Cambiar contraseña** `POST /v1/auth/cambiar-contrasena` con `{ "contrasenaActual", "contrasenaNueva" }` (8 a 128 caracteres, distinta de la actual): apaga `debe_cambiar_contrasena`, cierra las demás sesiones y devuelve un par de tokens nuevo. Mientras `debe_cambiar_contrasena` sea verdadero, la cuenta solo puede llamar a este endpoint y a `/auth/salir`.

**Salir** `POST /v1/auth/salir` con `{ "tokenRefresco" }`: revoca ese token; responde 204.

**Cuentas (solo SA).** `GET /cuentas` devuelve las cuentas (usuario, cargo, persona, manzana y estado: activa, bloqueada, desactivada, debe cambiar contraseña, cargo no vigente) y las asignaciones vigentes sin cuenta. `POST /cuentas` con `{ asignacionId, usuario }` devuelve la contraseña temporal **una sola vez**. Restablecer genera otra contraseña temporal y cierra las sesiones; bloquear (indefinido hasta desbloquear), desbloquear y desactivar piden `motivo`. Todo queda en la bitácora técnica. El SA no puede bloquear ni desactivar su propia cuenta.

## Detalle: organización y autorizaciones

- **Secciones y manzanas.** SEC las crea y edita; el resto del comité y los jefes las consultan. La clave no cambia después de creada (forma el código visible S1-M03); el nombre y `activa` sí. No se crean manzanas en una sección inactiva ni se asignan jefes a una manzana inactiva. La manzana incluye a su **jefe vigente**; su teléfono solo lo ven el comité y el propio jefe (RF-ORG-06).
- **Asignaciones.** SEC registra la asignación y se crea una autorización pendiente para PRE. Una solicitud pendiente ya ocupa el lugar: un jefe por manzana y una manzana por jefe (`JEFE_YA_ASIGNADO`), y un solo presidente, tesorero y secretario (`CARGO_YA_ASIGNADO`). Al **rechazarse**, la asignación se cierra con `fecha_fin = fecha_inicio` y libera la manzana o el cargo. Estado calculado: pendiente, rechazada, programada, vigente o cerrada.
- **Cerrar** (`/asignaciones/{id}/cerrar`, SEC, con `fechaFin` no posterior a hoy y `motivo`): fin de periodo de un cargo del comité; en la misma transacción desactiva su cuenta y cierra sus sesiones (D-22). Un jefe de manzana no se cierra: se sustituye con acta de entrega (D-08, paso 8 de la API).
- **Autorizaciones.** `GET /autorizaciones?estado=pendiente|resueltas|todas`: PRE ve todas; cada cargo ve las que pidió. `POST /autorizaciones/{id}/resolver` con `{ resultado, motivo }`: solo PRE; motivo obligatorio al rechazar; `AUTORIZACION_RESUELTA` si ya se resolvió. Cada módulo registra qué pasa al autorizar o rechazar una solicitud de su tipo; la resolución, ese efecto y la bitácora van en una sola transacción.

## Ejemplo: registrar pago

`POST /v1/pagos` con `Idempotency-Key`:

```json
{
  "unidadId": 45,
  "periodos": ["2026-06", "2026-07"],
  "cargosExtraordinarios": [],
  "folioReciboPapel": "001234",
  "totalEsperado": 20000
}
```

Respuesta 201:

```json
{
  "id": 981,
  "folio": "PG-000981",
  "unidad": { "folio": "U-000045", "titular": "Juan Pérez López" },
  "meses": [
    { "periodo": "2026-06", "tarifaBase": 5000, "recargo": 5000, "total": 10000 },
    { "periodo": "2026-07", "tarifaBase": 5000, "recargo": 5000, "total": 10000 }
  ],
  "total": 20000,
  "caja": "S1-M03",
  "reciboPapel": "001234",
  "fechaHora": "2026-10-25T18:30:00Z"
}
```

Si el total recalculado no coincide con `totalEsperado` → 409 `TOTAL_CAMBIO` con el nuevo resumen. Si la misma `Idempotency-Key` llega otra vez → se devuelve el pago ya registrado.

## Códigos de error

| Código                   | HTTP | Cuándo                                                   |
| ------------------------ | ---- | -------------------------------------------------------- |
| CREDENCIALES_INVALIDAS   | 401  | Usuario o contraseña incorrectos                         |
| CUENTA_BLOQUEADA         | 401  | Por intentos fallidos o por el SA                        |
| CARGO_NO_VIGENTE         | 403  | La asignación de la cuenta ya se cerró                   |
| FUERA_DE_ALCANCE         | 403  | Recurso de otra manzana                                  |
| ASIGNACION_CON_CUENTA    | 409  | La asignación ya tiene cuenta                            |
| ASIGNACION_NO_VIGENTE    | 422  | Se pidió una cuenta para una asignación pendiente, rechazada, cerrada o aún sin iniciar |
| USUARIO_REPETIDO         | 409  | El nombre de usuario ya existe                           |
| HOMONIMO_SIN_DISTINTIVO  | 422  | Mismo nombre sin distintivo                              |
| DISTINTIVO_REPETIDO      | 409  | Nombre + distintivo ya existe                            |
| ORDEN_DE_MESES           | 422  | No se eligió desde el más antiguo o hay huecos           |
| PERIODO_YA_PAGADO        | 409  | Algún mes ya está cubierto                               |
| TOTAL_CAMBIO             | 409  | El total recalculado no coincide                         |
| FOLIO_PAPEL_REPETIDO     | 409  | Folio ya usado en esa caja                               |
| PERIODO_CERRADO          | 409  | Fecha dentro de un mes con corte cerrado                 |
| SALDO_INSUFICIENTE       | 422  | Entrega o gasto mayor al saldo esperado                  |
| TOMA_NO_ACTIVA           | 422  | Agregar familia a toma no activa                         |
| JEFE_YA_ASIGNADO         | 409  | La manzana ya tiene jefe o la persona ya es jefe de otra |
| CARGO_YA_ASIGNADO        | 409  | Ya hay presidente, tesorero o secretario abierto (vigente o pendiente) |
| CLAVE_REPETIDA           | 409  | Clave o nombre de sección, o clave de manzana, ya registrado |
| TARIFA_VIGENCIA_INVALIDA | 422  | Vigencia no posterior al mes actual                      |
| AUTORIZACION_RESUELTA    | 409  | La solicitud ya fue resuelta                             |

### Códigos generales

Los usa cualquier endpoint; no dependen de una regla de negocio.

| Código                          | HTTP | Cuándo                                                                                   |
| ------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| DATOS_INVALIDOS                 | 400  | La validación Zod falló; `detalles.problemas` lista cada campo con su mensaje            |
| SOLICITUD_INVALIDA              | 400  | El cuerpo no es JSON válido o la solicitud está mal formada                              |
| CLAVE_IDEMPOTENCIA_REQUERIDA    | 400  | Falta `Idempotency-Key` o no es un UUID en un POST que mueve dinero                      |
| NO_AUTENTICADO                  | 401  | Sin token de acceso o token inválido                                                     |
| SESION_VENCIDA                  | 401  | El token de acceso venció; la app debe refrescarlo                                       |
| CUENTA_DESACTIVADA              | 401  | La cuenta fue desactivada por el SA o al cerrarse su asignación                          |
| CAMBIO_CONTRASENA_OBLIGATORIO   | 403  | La cuenta debe cambiar su contraseña antes de usar otros endpoints                       |
| SIN_PERMISO                     | 403  | El cargo de la cuenta no puede hacer esa operación                                       |
| NO_ENCONTRADO                   | 404  | La ruta o el recurso no existe                                                           |
| CLAVE_IDEMPOTENCIA_REUTILIZADA  | 409  | La `Idempotency-Key` ya se usó en otra operación o por otra cuenta                       |
| DEMASIADAS_SOLICITUDES          | 429  | Se superó el límite de solicitudes                                                       |
| ERROR_INTERNO                   | 500  | Error inesperado; el detalle queda solo en el registro del servidor                      |
| BASE_DE_DATOS_NO_DISPONIBLE     | 503  | La base de datos no responde (también lo usa `/health`)                                  |

Una cuenta se valida contra la base en **cada** solicitud autenticada (desactivación, bloqueo y vigencia de la asignación), no solo en las operaciones de dinero: un bloqueo surte efecto de inmediato. Si la misma `Idempotency-Key` llega otra vez de la misma cuenta y a la misma ruta, se devuelve la respuesta guardada con el encabezado `Idempotent-Replayed: true`; las claves se guardan 24 h.
