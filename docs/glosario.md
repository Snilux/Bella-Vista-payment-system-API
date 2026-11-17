# Glosario español → inglés para el código

La redacción de la documentación de negocio está en español; el código, los identificadores y los commits, en inglés. Los contratos (rutas, parámetros, campos JSON, valores de enum y códigos de error) usan el nombre real en inglés también en `docs/api.md` y en Notion 2.3 y 3.2. La base de datos se sigue describiendo en español en `modelo-datos.md`. Este archivo fija la traducción para que todos usen los mismos nombres. Si al programar aparece un término que no está aquí, se agrega en el mismo commit.

Lo que ve el usuario final (mensajes de error, recibos, fechas y montos con formato) **sigue en español**.

## Reglas generales

- Tablas y columnas en inglés, `snake_case`, singular; Drizzle las expone en `camelCase`.
- Rutas de la API en inglés, `kebab-case`, en plural: `/v1/payments`, `/v1/closings/{id}/close`.
- Campos JSON en `camelCase` inglés.
- Errores: `{ "error": { "code": "PERIOD_ALREADY_PAID", "message": "Junio 2026 ya está pagado.", "details": {} } }`. El `code` va en inglés y el `message` en español.
- Paginación: `?limit=20&cursor=...` → `{ data: [], next: "cursor" }`.
- Los prefijos de folio visibles (`P-`, `T-`, `PG-`, `CO-`...) no cambian; la columna se llama `folio`.
- En los nombres de módulo y de alcance de commit se usa la traducción de la tabla de abajo.

## Módulos

| Español        | Inglés         |
| -------------- | -------------- |
| auth           | `auth`         |
| cuentas        | `accounts`     |
| organizacion   | `organization` |
| padron         | `registry`     |
| tomas          | `connections`  |
| tarifas        | `rates`        |
| cobranza       | `billing`      |
| cajas          | `cashboxes`    |
| comite         | `committee`    |
| cortes         | `closings`     |
| reportes       | `reports`      |
| autorizaciones | `approvals`    |
| auditoria      | `audit`        |

## Tablas

| Español                   | Inglés                   |
| ------------------------- | ------------------------ |
| `seccion`                 | `section`                |
| `manzana`                 | `block`                  |
| `persona`                 | `person`                 |
| `asignacion_cargo`        | `role_assignment`        |
| `usuario`                 | `user_account`           |
| `token_refresco`          | `refresh_token`          |
| `acuerdo`                 | `agreement`              |
| `solicitud_toma`          | `connection_request`     |
| `toma`                    | `connection`             |
| `toma_manzana`            | `connection_block`       |
| `unidad`                  | `unit`                   |
| `unidad_titular`          | `unit_holder`            |
| `suspension`              | `suspension`             |
| `solicitud_cambio_unidad` | `unit_change_request`    |
| `tarifa`                  | `rate`                   |
| `concepto`                | `fee`                    |
| `concepto_importe`        | `fee_amount`             |
| `cargo_extraordinario`    | `extra_charge`           |
| `pago`                    | `payment`                |
| `pago_mes`                | `payment_month`          |
| `periodo_cubierto`        | `covered_period`         |
| `pago_concepto`           | `payment_charge`         |
| `recibo_papel`            | `paper_receipt`          |
| `pago_cancelacion`        | `payment_cancellation`   |
| `caja`                    | `cashbox`                |
| `saldo_inicial`           | `opening_balance`        |
| `entrega`                 | `handover`               |
| `aclaracion`              | `adjustment`             |
| `ingreso`                 | `income`                 |
| `categoria_gasto`         | `expense_category`       |
| `gasto`                   | `expense`                |
| `gasto_reintegro`         | `expense_refund`         |
| `fontanero`               | `plumber`                |
| `fontanero_salario`       | `plumber_salary`         |
| `fontanero_pago`          | `plumber_payment`        |
| `corte`                   | `closing`                |
| `autorizacion`            | `approval`               |
| `bitacora`                | `audit_log`              |
| `idempotencia`            | `idempotency_key`        |
| `v_<tabla>`               | `v_<tabla en inglés>`    |

## Columnas frecuentes

| Español                          | Inglés                               |
| -------------------------------- | ------------------------------------ |
| `clave`                          | `code`                               |
| `nombre`, `nombres`              | `name`, `given_names`                |
| `apellido_paterno` / `_materno`  | `paternal_surname` / `maternal_surname` |
| `distintivo`                     | `distinguishing_note`                |
| `telefono`                       | `phone`                              |
| `direccion`                      | `address`                            |
| `activa`, `activo`               | `active`                             |
| `importe`                        | `amount`                             |
| `periodo`                        | `period`                             |
| `fecha`, `fecha_hora`            | `date`, `occurred_at`                |
| `fecha_registro`                 | `registered_on`                      |
| `fecha_activacion` / `fecha_baja`| `activated_on` / `deactivated_on`    |
| `fecha_inicio` / `fecha_fin`     | `start_date` / `end_date`            |
| `desde` / `hasta`                | `valid_from` / `valid_to`            |
| `vigente_desde`                  | `effective_from`                     |
| `periodo_vigencia`               | `effective_period`                   |
| `fecha_aprobacion`               | `approved_on`                        |
| `fecha_cargo`                    | `charged_on`                         |
| `motivo`                         | `reason`                             |
| `observaciones`                  | `notes`                              |
| `referencia_comprobante`         | `voucher_reference`                  |
| `contrasena_hash`                | `password_hash`                      |
| `debe_cambiar_contrasena`        | `must_change_password`               |
| `intentos_fallidos`              | `failed_attempts`                    |
| `bloqueado_hasta`                | `locked_until`                       |
| `clave_idempotencia`             | `idempotency_key`                    |
| `con_recargo`                    | `with_surcharge`                     |
| `efectivo_contado`               | `counted_cash`                       |
| `importe_declarado` / `_recibido`| `declared_amount` / `received_amount`|
| `custodio_persona_id`            | `custodian_person_id`                |
| `caja_origen_id`                 | `source_cashbox_id`                  |
| `creado_por` / `creado_en`       | `created_by` / `created_at`          |
| `revisado_*`, `cerrado_*`, `confirmada_*`, `cancelada_*`, `rechazado_*`, `retirada_*`, `resuelto_*`, `revocado_*`, `desactivado_*` | `reviewed_*`, `closed_*`, `confirmed_*`, `cancelled_*`, `rejected_*`, `withdrawn_*`, `resolved_*`, `revoked_*`, `deactivated_*` (`_en` → `_at`, `_por` → `_by`) |
| `antes` / `despues`              | `before` / `after`                   |
| `es_tecnica`                     | `is_technical`                       |
| `seccion_id`, `manzana_id`, `persona_id` | `section_id`, `block_id`, `person_id` |
| `autorizacion_id`, `asignacion_cargo_id`, `usuario_id` | `approval_id`, `role_assignment_id`, `user_account_id` |
| `cargo` (columna de asignación)  | `role`                               |
| `telefono_contacto`              | `contact_phone`                      |
| `usuario` (columna de usuario)   | `username`                           |
| `token_hash`                     | `token_hash`                         |
| `expira_en`                      | `expires_at`                         |
| `reemplazado_por`                | `replaced_by_id`                     |
| `fecha_junta`                    | `meeting_date`                       |
| `tema`                           | `topic`                              |
| `resultado`                      | `result`                             |
| `votos_favor` / `votos_contra`   | `votes_for` / `votes_against`        |
| `abstenciones`                   | `abstentions`                        |
| `referencia_acta`                | `minutes_reference`                  |
| `corrige_a_id`                   | `corrects_id`                        |
| `tipo`                           | `type`                               |
| `solicitado_por` / `solicitado_en` | `requested_by` / `requested_at`    |
| `motivo_resolucion`              | `resolution_reason`                  |
| `solicitante_id`                 | `applicant_id`                       |
| `fecha_solicitud`                | `requested_on`                       |
| `cancelada_en`, `cancelado_en` (date) | `cancelled_on`                  |
| `motivo_cancelacion`             | `cancellation_reason`                |
| `motivo_baja`                    | `deactivation_reason`                |
| `solicitud_toma_id`, `toma_id`, `unidad_id`, `acuerdo_id` | `connection_request_id`, `connection_id`, `unit_id`, `agreement_id` |
| `pago_id`, `caja_id`, `tarifa_id`, `concepto_id`, `cargo_extraordinario_id` | `payment_id`, `cashbox_id`, `rate_id`, `fee_id`, `extra_charge_id` |
| `folio_papel`                    | `paper_folio`                        |
| `fecha` (recibo_papel, timestamptz) | `issued_at`                       |
| `referencia`                     | `reference`                          |
| `periodo_inicio_cobro`           | `billing_start_period`               |
| `periodo_desde` / `periodo_hasta`| `period_from` / `period_to`          |
| `nuevo_titular_id`               | `new_holder_id`                      |
| `concepto` (columna de ingreso)  | `concept`                            |
| `descripcion`                    | `description`                        |
| `es_salario_fontanero`           | `is_plumber_salary`                  |
| `fecha_pago`                     | `paid_on`                            |
| `motivo_rechazo`                 | `rejection_reason`                   |
| `periodicidad`                   | `frequency`                          |
| `periodo_inicio`                 | `period_start`                       |
| `categoria_id`, `gasto_id`, `fontanero_id`, `fontanero_salario_id` | `category_id`, `expense_id`, `plumber_id`, `plumber_salary_id` |
| `fecha_desde` / `fecha_hasta`    | `date_from` / `date_to`              |
| `entrega_id`, `corte_id`         | `handover_id`, `closing_id`          |
| `accion`                         | `action`                             |
| `tabla` (columna de bitácora)    | `table_name`                         |
| `registro_id`                    | `record_id`                          |
| `clave` (columna de idempotencia)| `key`                                |
| `ruta`                           | `route`                              |
| `respuesta`                      | `response`                           |

Las columnas `*_en` de tipo `date` (no `timestamptz`) terminan en `_on`, igual que las `fecha_*`: `cancelada_en` → `cancelled_on`. La regla `_en` → `_at` es para timestamps.

## Funciones de base de datos

| Español        | Inglés             |
| -------------- | ------------------ |
| `f_normalizar` | `f_normalize_name` |

## Valores de enum

| Español                                                                                  | Inglés                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| cargo: superadmin, presidente, tesorero, secretario, vocal, jefe_manzana                 | `superadmin`, `president`, `treasurer`, `secretary`, `member`, `block_leader`          |
| tipo de caja (`cashbox_type`): manzana, comite, apoyo                                    | `block`, `committee`, `support`                                                        |
| tipo de corte (`closing_type`): mensual, extraordinario                                  | `monthly`, `extraordinary`                                                             |
| tipo de concepto (`fee_type`): apertura, reinstalacion, reparacion, otro                 | `opening`, `reconnection`, `repair`, `other`                                           |
| tipo de recibo (`receipt_type`): original, reposicion                                    | `original`, `replacement`                                                              |
| periodicidad (`salary_frequency`): semanal, quincenal, mensual                           | `weekly`, `biweekly`, `monthly`                                                        |
| resultado de acuerdo: aprobado_mayoria, rechazado                                        | `approved_by_majority`, `rejected`                                                     |
| resultado de autorización: autorizada, rechazada                                         | `approved`, `rejected`                                                                 |
| tipo de solicitud de cambio: baja, cambio_titular                                        | `deactivation`, `holder_change`                                                        |
| tipo de autorización: asignacion_cargo, tarifa, salario_fontanero, saldo_inicial, baja_unidad, cambio_titular, cancelacion_pago, aclaracion, reintegro_gasto | `role_assignment`, `rate`, `plumber_salary`, `opening_balance`, `unit_deactivation`, `holder_change`, `payment_cancellation`, `adjustment`, `expense_refund` |

## Estados calculados en vistas

No se guardan: las vistas los derivan de las fechas de cada hecho (columna `status`, texto).

| Español | Inglés |
| --- | --- |
| toma (`v_connection`): activa, suspendida, baja | `active`, `suspended`, `deactivated` |
| solicitud de toma (`v_connection_request`): solicitada, aprobada pendiente de pago, pendiente de instalación, rechazada, cancelada, instalada | `requested`, `approved_pending_payment`, `pending_installation`, `rejected`, `cancelled`, `installed` |
| unidad (`v_unit`): pendiente de activación, activa, suspendida, baja | `pending_activation`, `active`, `suspended`, `deactivated` |
| entrega (`v_handover`): pendiente, retirada, confirmada, con diferencia, aclarada | `pending`, `withdrawn`, `confirmed`, `with_difference`, `adjusted` |
| gasto (`v_expense`): pendiente de pago, pagado, rechazado, reintegrado | `pending_payment`, `paid`, `rejected`, `refunded` |
| corte (`v_closing`): borrador, contado, revisado, cerrado | `draft`, `counted`, `reviewed`, `closed` |
| tipo de movimiento de caja (`v_cashbox_movement.kind`): saldo inicial, pago, cancelación de pago, entrega (salida), entrega (entrada), ingreso, gasto, reintegro, aclaración | `opening_balance`, `payment`, `payment_cancellation`, `handover_out`, `handover_in`, `income`, `expense`, `expense_refund`, `adjustment` |

## Variables de entorno

| Español | Inglés |
| --- | --- |
| `DATABASE_URL_MIGRACIONES` | `DATABASE_URL_MIGRATIONS` |

## Conceptos de dominio

| Español                     | Inglés               |
| --------------------------- | -------------------- |
| jefe de manzana             | block leader         |
| mensualidad                 | monthly fee          |
| recargo                     | surcharge            |
| mes vencido                 | overdue month        |
| ciclo de adeudo             | arrears cycle        |
| estado de cuenta            | account statement    |
| saldo                       | balance              |
| periodo cerrado             | closed period        |
| bitácora                    | audit log            |
| arranque inicial            | bootstrap            |
| autorizada por arranque     | approved by bootstrap |
| contraseña temporal         | temporary password   |
| registro técnico (bitácora) | technical entry (`is_technical`) |
| datos de desarrollo         | development seed data (`db:seed:dev`) |

## Archivo de arranque (`arranque.json`)

Lo llena quien ejecuta `pnpm db:seed`, así que sus claves quedan en español (ver `arranque.example.json`). En el código se leen tal cual:

| Clave | Uso en el código |
| --- | --- |
| `superadministrador` (`nombres`, `apellidoPaterno`, `apellidoMaterno`, `distintivo`, `telefono`, `usuario`) | `person` + `role_assignment` (`superadmin`) + `user_account` |
| `acuerdo` (`fechaJunta`, `tema`, `votosFavor`, `votosContra`, `abstenciones`, `referenciaActa`) | `agreement` (`meeting_date`, `topic`, `votes_for`, `votes_against`, `abstentions`, `minutes_reference`) |
| `presidente`, `tesorero`, `secretario` (datos de persona y `fechaInicio`) | `role_assignment` (`president`, `treasurer`, `secretary`; `start_date`) |

## Códigos de error

El código, la respuesta (`error.code`), `docs/api.md` y Notion 2.3 usan el nombre en inglés; la columna en español es el nombre de negocio. El `message` sigue en español.

| Español | Inglés |
| --- | --- |
| `CREDENCIALES_INVALIDAS` | `INVALID_CREDENTIALS` |
| `CUENTA_BLOQUEADA` | `ACCOUNT_LOCKED` |
| `CARGO_NO_VIGENTE` | `ROLE_NOT_ACTIVE` |
| `FUERA_DE_ALCANCE` | `OUT_OF_SCOPE` |
| `ASIGNACION_CON_CUENTA` | `ASSIGNMENT_HAS_ACCOUNT` |
| `ASIGNACION_NO_VIGENTE` | `ASSIGNMENT_NOT_ACTIVE` |
| `USUARIO_REPETIDO` | `USERNAME_TAKEN` |
| `HOMONIMO_SIN_DISTINTIVO` | `HOMONYM_WITHOUT_NOTE` |
| `DISTINTIVO_REPETIDO` | `DUPLICATE_DISTINGUISHING_NOTE` |
| `ORDEN_DE_MESES` | `MONTH_ORDER` |
| `PERIODO_YA_PAGADO` | `PERIOD_ALREADY_PAID` |
| `TOTAL_CAMBIO` | `TOTAL_CHANGED` |
| `FOLIO_PAPEL_REPETIDO` | `DUPLICATE_PAPER_FOLIO` |
| `PERIODO_CERRADO` | `PERIOD_CLOSED` |
| `SALDO_INSUFICIENTE` | `INSUFFICIENT_BALANCE` |
| `TOMA_NO_ACTIVA` | `CONNECTION_NOT_ACTIVE` |
| `CONCEPTO_SIN_IMPORTE` | `FEE_WITHOUT_AMOUNT` |
| `APERTURA_NO_PAGADA` | `OPENING_NOT_PAID` |
| `ESTADO_INVALIDO` | `INVALID_STATE` |
| `JEFE_YA_ASIGNADO` | `LEADER_ALREADY_ASSIGNED` |
| `CARGO_YA_ASIGNADO` | `ROLE_ALREADY_ASSIGNED` |
| `CLAVE_REPETIDA` | `DUPLICATE_CODE` |
| `TARIFA_VIGENCIA_INVALIDA` | `INVALID_RATE_EFFECTIVE_PERIOD` |
| `AUTORIZACION_RESUELTA` | `APPROVAL_ALREADY_RESOLVED` |
| `DATOS_INVALIDOS` | `VALIDATION_ERROR` |
| `SOLICITUD_INVALIDA` | `INVALID_REQUEST` |
| `CLAVE_IDEMPOTENCIA_REQUERIDA` | `IDEMPOTENCY_KEY_REQUIRED` |
| `NO_AUTENTICADO` | `UNAUTHENTICATED` |
| `SESION_VENCIDA` | `TOKEN_EXPIRED` |
| `CUENTA_DESACTIVADA` | `ACCOUNT_DISABLED` |
| `CAMBIO_CONTRASENA_OBLIGATORIO` | `PASSWORD_CHANGE_REQUIRED` |
| `SIN_PERMISO` | `FORBIDDEN` |
| `NO_ENCONTRADO` | `NOT_FOUND` |
| `CLAVE_IDEMPOTENCIA_REUTILIZADA` | `IDEMPOTENCY_KEY_REUSED` |
| `DEMASIADAS_SOLICITUDES` | `TOO_MANY_REQUESTS` |
| `ERROR_INTERNO` | `INTERNAL_ERROR` |
| `BASE_DE_DATOS_NO_DISPONIBLE` | `DATABASE_UNAVAILABLE` |

Códigos que genera la app móvil (cliente HTTP), no la API; tienen mensaje en `apps/mobile/src/api/error-messages.ts` como los demás:

| Español | Inglés | Cuándo |
| --- | --- | --- |
| `SIN_CONEXION` | `NETWORK_ERROR` | La petición no tuvo respuesta: sin red o sin respuesta en 15 s |
| `RESPUESTA_INVALIDA` | `INVALID_RESPONSE` | La respuesta no coincide con el esquema de `packages/shared` (la API cambió y la app no) |

Campos de `detalles` (`details`): `problemas` → `issues`, cada uno con `ruta` → `path` y `mensaje` → `message`.

Encabezados: `Idempotency-Key` y `Idempotent-Replayed` no se traducen.

## Parámetros de consulta

Los filtros de las listas (`?nombre=valor`) van en `camelCase` inglés, como los campos JSON.

| Español | Inglés |
| --- | --- |
| `?limite=&cursor=` | `?limit=&cursor=` |
| `?q=` (búsqueda) | `?q=` |
| `?nombres=&ap=&am=` (coincidencias de personas) | `?givenNames=&paternalSurname=&maternalSurname=` |
| `?unidad=`, `?manzana=`, `?seccion=`, `?caja=` | `?unitId=`, `?blockId=`, `?sectionId=`, `?cashboxId=` |
| `?periodo=` (cortes) | `?period=` |
| `?cargo=` (asignaciones) | `?role=` |
| `?estado=` (autorizaciones, asignaciones, solicitudes de toma, entregas, gastos, cortes) | `?status=`, con los valores de "Estados calculados en vistas", del estado de asignación o del filtro de bandeja |
| `?desde=&hasta=` | `?from=&to=` (fechas en pagos, movimientos y bitácora; meses en reportes) |
| `?usuario=&tabla=&registro=&accion=` (bitácora) | `?userAccountId=&tableName=&recordId=&action=` |

## Rutas y campos de sesión y cuentas

| Español | Inglés |
| --- | --- |
| `/auth/login` | `/v1/auth/login` |
| `/auth/refrescar` | `/v1/auth/refresh` |
| `/auth/cambiar-contrasena` | `/v1/auth/change-password` |
| `/auth/salir` | `/v1/auth/logout` |
| `/cuentas` | `/v1/accounts` |
| `/cuentas/{id}/restablecer` | `/v1/accounts/{id}/reset-password` |
| `/cuentas/{id}/bloquear`, `/desbloquear`, `/desactivar` | `/v1/accounts/{id}/lock`, `/unlock`, `/deactivate` |
| `usuario`, `contrasena` | `username`, `password` |
| `contrasenaActual`, `contrasenaNueva` | `currentPassword`, `newPassword` |
| `tokenAcceso`, `tokenAccesoExpiraEn`, `tokenRefresco` | `accessToken`, `accessTokenExpiresIn`, `refreshToken` |
| `cuenta`, `debeCambiarContrasena`, `manzanaId` | `account`, `mustChangePassword`, `blockId` |
| nombre completo de la persona del cargo, clave visible de la manzana (S1-M03) | `fullName`, `blockCode` |
| `asignacionId`, `contrasenaTemporal`, `motivo` | `roleAssignmentId`, `temporaryPassword`, `reason` |
| `asignacionesSinCuenta` | `assignmentsWithoutAccount` |
| `bloqueadaHasta` | `lockedUntil` |
| estado de cuenta de acceso: activa, bloqueada, desactivada, debe cambiar contraseña, cargo no vigente | `active`, `locked`, `disabled`, `must_change_password`, `role_not_active` |

## Rutas y campos de organización y autorizaciones

| Español | Inglés |
| --- | --- |
| `/secciones`, `/secciones/{id}`, `/manzanas`, `/manzanas/{id}` | `/v1/sections`, `/v1/sections/{id}`, `/v1/blocks`, `/v1/blocks/{id}` |
| `/asignaciones`, `/asignaciones/{id}/cerrar` | `/v1/role-assignments`, `/v1/role-assignments/{id}/close` |
| `/autorizaciones`, `/autorizaciones/{id}/resolver` | `/v1/approvals`, `/v1/approvals/{id}/resolve` |
| `codigo` de manzana (S1-M03) | `fullCode` (la clave sola es `code`) |
| `jefe`, `telefonoContacto` | `leader`, `contactPhone` |
| `personaId`, `cargo`, `manzanaId`, `fechaInicio`, `fechaFin` | `personId`, `role`, `blockId`, `startDate`, `endDate` |
| `tieneCuenta` | `hasAccount` |
| `resultado`, `motivo`, `descripcion` | `result`, `reason`, `description` |
| `solicitadoPor`, `resueltoPor` | `requestedBy`, `resolvedBy` |
| estado de asignación: pendiente, rechazada, programada, vigente, cerrada | `pending`, `rejected`, `scheduled`, `active`, `closed` |
| filtro de bandeja: pendiente, resueltas, todas | `pending`, `resolved`, `all` |
| manejador de autorización (por tipo) | approval handler (`approvalRegistry`) |

## Rutas y campos de padrón y tomas

| Español | Inglés |
| --- | --- |
| `/buscar` | `/v1/search` |
| `/personas`, `/personas/coincidencias` | `/v1/people`, `/v1/people/matches` |
| `/unidades`, `/unidades/{id}/solicitar-baja`, `/solicitar-cambio-titular` | `/v1/units`, `/v1/units/{id}/request-deactivation`, `/request-holder-change` |
| `/suspensiones`, `/suspensiones/{id}/terminar` | `/v1/suspensions`, `/v1/suspensions/{id}/end` |
| `/tomas/preexistentes`, `/tomas/{id}` | `/v1/connections/pre-existing`, `/v1/connections/{id}` |
| `/acuerdos` | `/v1/agreements` |
| `/solicitudes-toma`, `/{id}`, `/{id}/resolver`, `/{id}/activar`, `/{id}/cancelar` | `/v1/connection-requests`, `/{id}`, `/{id}/resolve`, `/{id}/activate`, `/{id}/cancel` |
| `acceso` de la ficha de persona: completo, básico | `access`: `full`, `basic` |
| unidad de otra manzana | `{ scope: "other_block" }` |
| `coincidencias`: exactas, parecidas | `exact`, `similar` |
| `titularId`, `nuevoTitularId`, `solicitanteId` | `holderPersonId`, `newHolderId`, `applicantId` |
| `cambioPendiente`, `cargoApertura` | `pendingChange`, `openingCharge` |
| `estado`, `accion` (detalles de `ESTADO_INVALIDO`) | `status`, `action` |

## Estado de cuenta

| Español | Inglés |
| --- | --- |
| `/unidades/{id}/estado-cuenta` | `/v1/units/{id}/account-statement` |
| `periodoActual` | `currentPeriod` |
| estado del mes: pendiente, vencido, pagado, anticipo | `pending`, `overdue`, `paid`, `advance` |
| `tarifaBase`, `recargo`, `total` | `baseAmount`, `surcharge`, `total` |
| `vencidos`, `pendientes`, `cicloDeAdeudo` | `overdueCount`, `pendingCount`, `inDebtCycle` |
| `totalVencido`, `totalPendiente`, `totalRecargo`, `totalAdeudado`, `anticipos` | `overdueTotal`, `pendingTotal`, `surchargeTotal`, `totalDue`, `advanceCount` |
| `periodosSinTarifa` | `missingRatePeriods` |
| `adeudo` (resumen en fichas y búsqueda) | `debt` |
| último mes cobrable (mes de la baja, inclusive) | `lastBillablePeriod` |
| orden de pago: selección vacía, periodo inválido, repetido, ya pagado, no cobrable, orden de meses, sin tarifa | `EMPTY_SELECTION`, `INVALID_PERIOD`, `DUPLICATE_PERIOD`, `PERIOD_ALREADY_PAID`, `PERIOD_NOT_BILLABLE`, `MONTH_ORDER`, `RATE_MISSING` |

## Tarifas, conceptos y cobranza

| Español | Inglés |
| --- | --- |
| `/tarifas` | `/v1/rates` |
| `/conceptos`, importes de un concepto | `/v1/fees`, `/v1/fees/{id}/amounts` |
| `periodoVigencia`, `importe`, `fechaAprobacion`, `acuerdoId` | `effectivePeriod`, `amount`, `approvedOn`, `agreementId` |
| estado de la tarifa: pendiente, autorizada, rechazada | `pending`, `approved`, `rejected` |
| `vigenteDesde`, `importeVigente`, `importes` | `effectiveFrom`, `currentAmount`, `amounts` |
| `/pagos/previsualizar` | `/v1/payments/preview` |
| `/pagos`, `/pagos/{id}` | `/v1/payments`, `/v1/payments/{id}` |
| `/pagos/{id}/reposiciones` | `/v1/payments/{id}/replacements` |
| `/pagos/{id}/solicitar-cancelacion` | `/v1/payments/{id}/request-cancellation` |
| `unidadId`, `periodos`, `cargosExtraordinarios` | `unitId`, `periods`, `extraChargeIds` |
| `folioReciboPapel`, `totalEsperado` | `paperFolio`, `expectedTotal` |
| `meses`, `cargos`, `caja`, `recibos` | `months`, `charges`, `cashbox`, `receipts` |
| tipo de mes cobrado: vencido, pendiente, anticipo | `kind`: `overdue`, `pending`, `advance` |
| `titular` (en la fecha del pago), `fechaHora`, `capturo` | `holder`, `occurredAt`, `capturedBy` |
| `cancelado`, `cancelaciones` | `cancelled`, `cancellations` |
| `previsualizacion` | `preview` |
| etiqueta de caja: clave de manzana, Comité, Apoyo · nombre | `label` |
| `desde`, `hasta` (filtro de pagos) | `from`, `to` |
| permiso de consultar pagos | `payments.view` |
| bloqueo de registro sin permiso UPDATE (advisory lock) | `lockRecord` (`db/locks.ts`) |

## Cajas y comité

| Español | Inglés |
| --- | --- |
| `/cajas`, `/cajas/mia`, `/cajas/{id}/movimientos` | `/v1/cashboxes`, `/v1/cashboxes/mine`, `/v1/cashboxes/{id}/movements` |
| `/cajas/{id}/saldo-inicial` | `/v1/cashboxes/{id}/opening-balance` |
| `/entregas`, `/{id}/retirar`, `/{id}/confirmar` | `/v1/handovers`, `/{id}/withdraw`, `/{id}/confirm` |
| `/aclaraciones` | `/v1/adjustments` |
| `/ingresos`, `/gastos`, `/categorias-gasto` | `/v1/incomes`, `/v1/expenses`, `/v1/expense-categories` |
| `/gastos/{id}`, `/gastos/{id}/pagar`, `/rechazar`, `/solicitar-reintegro` | `/v1/expenses/{id}`, `/v1/expenses/{id}/pay`, `/reject`, `/request-refund` |
| `/fontaneros`, `/{id}`, `/{id}/salarios`, `/{id}/pagos` | `/v1/plumbers`, `/{id}`, `/{id}/salaries`, `/{id}/payments` |
| `saldo`, `recaudado`, `entregado`, `pendienteDeEntregar`, `disponible` | `balance`, `collected`, `handedOver`, `pendingHandover`, `available` |
| `importeDeclarado`, `importeRecibido`, `diferencia`, `importeAclarado` | `declaredAmount`, `receivedAmount`, `difference`, `adjustedAmount` |
| `observaciones`, `preparo`, `confirmo` | `notes`, `preparedBy`, `confirmedBy` |
| estado de la entrega: pendiente, retirada, confirmada, con diferencia, aclarada | `pending`, `withdrawn`, `confirmed`, `with_difference`, `adjusted` |
| `entregaId` | `handoverId` |
| `referenciaComprobante` | `voucherReference` |
| estado del gasto: pendiente de pago, pagado, rechazado, reintegrado | `pending_payment`, `paid`, `rejected`, `refunded` |
| `categoriaId`, `esSalarioFontanero` | `categoryId`, `isPlumberSalary` |
| periodicidad: semanal, quincenal, mensual | `weekly`, `biweekly`, `monthly` |
| `salarioVigente`, `inicioPeriodo`, `finPeriodo` | `currentSalary`, `periodStart`, `periodEnd` |
| periodo de pago del fontanero | `plumberPayPeriod` (`packages/shared/src/domain/plumber.ts`) |
| permisos: ver cajas, registrar saldo inicial | `cashboxes.view`, `openingBalances.register` |

## Cortes, reportes y bitácora

| Español | Inglés |
| --- | --- |
| `/cortes`, `/{id}/conteo`, `/{id}/revisar`, `/{id}/cerrar` | `/v1/closings`, `/{id}/count`, `/{id}/review`, `/{id}/close` |
| tipo de corte: mensual, extraordinario | `monthly`, `extraordinary` |
| estado del corte: borrador, contado, revisado, cerrado | `draft`, `counted`, `reviewed`, `closed` |
| `efectivoContado`, `observaciones`, `diferencia` | `countedCash`, `notes`, `difference` |
| cifras: saldo inicial, saldos iniciales, cobros, cancelaciones, entregas (salida, entrada), ingresos, gastos, reintegros, aclaraciones, saldo esperado | `figures`: `startingBalance`, `openingBalances`, `payments`, `cancellations`, `handoversOut`, `handoversIn`, `incomes`, `expenses`, `refunds`, `adjustments`, `expectedBalance` |
| `preparo`, `reviso`, `cerro` | `preparedBy`, `reviewedBy`, `closedBy` |
| `corteId` (aclaración) | `closingId` |
| `/manzanas/{id}/sustitucion-jefe` | `/v1/blocks/{id}/leader-substitution` |
| jefe saliente, jefe entrante | `outgoing`, `incoming` |
| `/reportes/padron-manzana`, `/reportes/comunitario` | `/v1/reports/block`, `/v1/reports/community` |
| `desde`, `hasta` (meses del reporte) | `from`, `to` |
| adeudo a la fecha de consulta | `debtAsOf` |
| `mesesAdeudados`, `recaudadoMensualidades`, `recaudadoCargos` | `debtMonths`, `collectedFees`, `collectedCharges` |
| efectivo con el jefe, en apoyo, fondos comunitarios esperados, diferencias de cortes | `cashWithLeader`, `cashInSupport`, `expectedCommunityFunds`, `closingDifferences` |
| `/bitacora` | `/v1/audit-log` |
| `usuario`, `tabla`, `registro`, `accion`, `esTecnica` (filtros y campos de bitácora) | `userAccountId`, `tableName`, `recordId`, `action`, `isTechnical` |

## App móvil (`apps/mobile`)

Nombres de 2.4 y 3.2 en el código. Los textos que ve el usuario siguen en español.

| Español | Inglés |
| --- | --- |
| Botón (primario, secundario, texto, peligro) | `Button` (`primary`, `secondary`, `text`, `danger`) |
| Campo | `TextField` |
| Campo de importe (`CampoImporte`) | `AmountField` |
| Selector | `Select` |
| Opción (opción única) | `Radio` |
| Casilla | `Checkbox` |
| Etiqueta de estado: pagado, pendiente, vencido, recargo, anticipo, cancelado | `StatusTag` (`paid`, `pending`, `overdue`, `surcharge`, `advance`, `cancelled`) |
| Fila de mes | `MonthRow` |
| Fila de menú | `MenuRow` |
| Fila de lista | `ListRow` |
| Tarjeta de registro | `RecordCard` |
| Dato (par etiqueta-valor) | `DataRow` |
| Encabezado | `Header` |
| Barra de pestañas, pestaña | `TabBar`, `TabItem` |
| Chip | `Chip` |
| Buscador | `SearchField` |
| Aviso (en página) | `Notice` |
| Hoja inferior, hoja de confirmación | `BottomSheet`, `ConfirmSheet` |
| Pantalla de éxito | `SuccessScreen` |
| Envoltura de estados (`EstadoPantalla`): cargando, vacío, error, sin conexión, sin permiso | `ScreenState` (`loading`, `empty`, `error`, `offline`, `forbidden`) |
| Lista paginada (`ListaPaginada`) | `PaginatedList` |
| Mensajes de error (`mensajes-error.ts`) | `src/api/error-messages.ts` |
| Galería de componentes | `ComponentGallery` (ruta `/dev/gallery`, solo en desarrollo) |
| Hook de operación de dinero (`useOperacionDinero`) | `useMoneyOperation` (M6) |
| Menú por cargo (`menu-por-cargo.ts`), permisos de la interfaz (`permisos.ts`) | `src/session/role-menu.ts` (`ROLE_MENU`), `src/session/permissions.ts` (`useCan`) |
| Catálogo de pantallas (ID, ruta, título, hecha) | `src/session/screen-catalog.ts` (`SCREENS`) |
| Estado de la sesión: restaurando, sin respuesta, sin sesión, con sesión | `sessionStore` (`restoring`, `unreachable`, `signed-out`, `signed-in`), `useSession`, `useAccount` |
| motivo del cierre de sesión: vencida, cargo no vigente, cuenta desactivada, cuenta bloqueada | `SessionEndReason`: `expired`, `role-not-active`, `account-disabled`, `account-locked` (la contraseña temporal no cierra la sesión: lleva a C-02) |
| Pestañas del cargo, menú «Más», pantalla «Próximamente» | `RoleTabs`, `MoreMenu`, `ComingSoon` (`src/features/session/`) |
| Marco de pantalla (con barra inferior fija), grupo de filas de menú | `ScreenLayout`, `MenuGroup` |
