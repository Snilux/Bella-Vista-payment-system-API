# Glosario español → inglés para el código

La documentación de negocio está en español; el código, los identificadores y los commits, en inglés. Este archivo fija la traducción para que todos usen los mismos nombres. Si al programar aparece un término que no está aquí, se agrega en el mismo commit.

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
| `cancelada_en` (date)            | `cancelled_on`                       |
| `motivo_cancelacion`             | `cancellation_reason`                |
| `motivo_baja`                    | `deactivation_reason`                |
| `solicitud_toma_id`, `toma_id`, `unidad_id`, `acuerdo_id` | `connection_request_id`, `connection_id`, `unit_id`, `agreement_id` |
| `referencia`                     | `reference`                          |
| `periodo_inicio_cobro`           | `billing_start_period`               |
| `periodo_desde` / `periodo_hasta`| `period_from` / `period_to`          |
| `nuevo_titular_id`               | `new_holder_id`                      |

Las columnas `*_en` de tipo `date` (no `timestamptz`) terminan en `_on`, igual que las `fecha_*`: `cancelada_en` → `cancelled_on`. La regla `_en` → `_at` es para timestamps.

## Funciones de base de datos

| Español        | Inglés             |
| -------------- | ------------------ |
| `f_normalizar` | `f_normalize_name` |

## Valores de enum

| Español                                                                                  | Inglés                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| cargo: superadmin, presidente, tesorero, secretario, vocal, jefe_manzana                 | `superadmin`, `president`, `treasurer`, `secretary`, `member`, `block_leader`          |
| tipo de caja: manzana, comite, apoyo                                                     | `block`, `committee`, `support`                                                        |
| tipo de corte: mensual, extraordinario                                                   | `monthly`, `extraordinary`                                                             |
| tipo de concepto: apertura, reinstalacion, reparacion, otro                              | `opening`, `reconnection`, `repair`, `other`                                           |
| tipo de recibo: original, reposicion                                                     | `original`, `replacement`                                                              |
| periodicidad: semanal, quincenal, mensual                                                | `weekly`, `biweekly`, `monthly`                                                        |
| resultado de acuerdo: aprobado_mayoria, rechazado                                        | `approved_by_majority`, `rejected`                                                     |
| resultado de autorización: autorizada, rechazada                                         | `approved`, `rejected`                                                                 |
| tipo de solicitud de cambio: baja, cambio_titular                                        | `deactivation`, `holder_change`                                                        |
| tipo de autorización: asignacion_cargo, tarifa, salario_fontanero, saldo_inicial, baja_unidad, cambio_titular, cancelacion_pago, aclaracion, reintegro_gasto | `role_assignment`, `rate`, `plumber_salary`, `opening_balance`, `unit_deactivation`, `holder_change`, `payment_cancellation`, `adjustment`, `expense_refund` |

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
