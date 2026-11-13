# Modelo de datos (PostgreSQL 16)

Fuente: documento 2.2 de Notion (versión normalizada 1.1, con el cambio de cuentas D-22).

## Convenciones

- Tablas y columnas descritas en español; en el código van en inglés, `snake_case`, singular, según [glosario.md](glosario.md).
- PK `id bigint generated always as identity`, salvo tablas de relación con PK compuesta.
- Folios visibles con formato `<PREFIJO>-AAAAMM-NNNNNN` (ej. `P-202611-000001`): año y mes de creación en `America/Mexico_City` más un consecutivo global por secuencia que no se reinicia cada mes. Prefijos: `P-` persona, `T-` toma, `U-` unidad, `ST-` solicitud de toma, `PG-` pago, `EN-` entrega, `GA-` gasto, `IN-` ingreso, `AC-` acuerdo, `CO-` corte.
- Dinero `bigint` en centavos. Periodos `date` en día 1 (`CHECK (extract(day from periodo) = 1)`).
- Todas las tablas: `creado_por` (FK usuario) y `creado_en timestamptz default now()`.
- **No se guarda lo que se puede calcular** (estados, totales, saldos, diferencias): se obtiene en vistas.
- Registros de dinero solo de inserción; el usuario de BD de la API solo tiene INSERT/SELECT en pago, pago_mes, recibo_papel, entrega (salvo columnas de confirmación), ingreso, gasto (salvo fecha_pago y rechazo) y bitácora.

## Organización y acceso

| Tabla              | Columnas                                                                                                                                                                     | Reglas                                                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seccion`          | id, clave (S1), nombre, activa                                                                                                                                               | clave y nombre únicos                                                                                                                                                                                                                                               |
| `manzana`          | id, seccion_id, clave (M03), nombre?, activa                                                                                                                                 | único (seccion_id, clave); el código S1-M03 sale de la vista `v_manzana`                                                                                                                                                                                            |
| `persona`          | id, folio, nombres, apellido_paterno, apellido_materno?, distintivo?, telefono?, fecha_registro                                                                              | único (`f_normalizar(nombres, apellido_paterno, apellido_materno)`, `coalesce(distintivo,'')`); índice trigram sobre la misma expresión. `f_normalizar` es IMMUTABLE: une, quita acentos (unaccent) y pasa a minúsculas                                                                      |
| `asignacion_cargo` | id, persona_id, cargo (enum: presidente, tesorero, secretario, vocal, jefe_manzana, superadmin), manzana_id?, telefono_contacto?, fecha_inicio, fecha_fin?, autorizacion_id? | manzana y teléfono obligatorios solo para jefe_manzana (CHECK). Índices únicos parciales donde `fecha_fin is null`: (manzana_id) y (persona_id) para jefe_manzana (D-09); (cargo) para presidente, tesorero y secretario. autorizacion_id único y nulo solo para superadmin. fecha_fin se llena al cerrarla o al rechazarse |
| `usuario`          | id, asignacion_cargo_id, usuario, contrasena_hash, debe_cambiar_contrasena, desactivado_en?, bloqueado_hasta?, intentos_fallidos                                             | asignacion_cargo_id **único**: una cuenta por asignación (D-22); persona y cargo salen de la asignación. usuario único en minúsculas. Argon2id. debe_cambiar_contrasena es true tras el alta o un restablecimiento; intentos_fallidos es smallint y se reinicia al ingresar                                                                                                                      |
| `token_refresco`   | id, usuario_id, token_hash, expira_en, revocado_en?, reemplazado_por?                                                                                                        | token_hash único; reemplazado_por es FK a token_refresco; rotación con detección de reutilización                                                                                                                                                                                                           |

## Padrón y tomas

| Tabla                     | Columnas                                                                                                                                           | Reglas                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `acuerdo`                 | id, folio, fecha_junta, tema, resultado (aprobado_mayoria, rechazado), votos_favor?, votos_contra?, abstenciones?, referencia_acta?, corrige_a_id? | no se edita; se corrige con otro acuerdo                                                              |
| `solicitud_toma`          | id, folio, solicitante_id, direccion, manzana_id, fecha_solicitud, acuerdo_id?, motivo_resolucion?, cancelada_en?, motivo_cancelacion?             | motivo obligatorio si se rechaza o se cancela                                                         |
| `toma`                    | id, folio, solicitud_toma_id?, direccion, fecha_activacion, fecha_baja?, motivo_baja?                                                              | solicitud única; nula para tomas que ya existían al arrancar (D-18). Existe a partir de su activación; motivo_baja obligatorio con fecha_baja |
| `toma_manzana`            | toma_id, manzana_id, desde, hasta?                                                                                                                 | PK (toma_id, desde); único parcial (toma_id) donde hasta es nulo                                      |
| `unidad`                  | id, folio, toma_id, referencia?, fecha_registro, fecha_activacion?, periodo_inicio_cobro?, fecha_baja?                                             | periodo_inicio_cobro obligatorio si hay fecha_activacion (CHECK)                                      |
| `unidad_titular`          | unidad_id, persona_id, desde, hasta?                                                                                                               | PK (unidad_id, desde); único parcial (unidad_id) donde hasta es nulo                                  |
| `suspension`              | id, toma_id?, unidad_id?, periodo_desde, periodo_hasta?, motivo, acuerdo_id                                                                        | exactamente uno de toma_id o unidad_id (`num_nonnulls = 1`)                                           |
| `solicitud_cambio_unidad` | id, unidad_id, tipo (baja, cambio_titular), nuevo_titular_id?, autorizacion_id                                                                     | nuevo titular solo en cambio_titular; el motivo vive en la autorización; autorizacion_id único                               |

## Tarifas y conceptos

| Tabla                  | Columnas                                                                              | Reglas                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `tarifa`               | id, periodo_vigencia, importe, fecha_aprobacion, acuerdo_id, autorizacion_id          | importe > 0; autorizacion_id único; trigger: una sola tarifa autorizada por periodo_vigencia                                                                      |
| `concepto`             | id, tipo (apertura, reinstalacion, reparacion, otro), nombre                          | nombre único                                                                                                                  |
| `concepto_importe`     | concepto_id, vigente_desde, importe                                                   | PK (concepto_id, vigente_desde)                                                                                               |
| `cargo_extraordinario` | id, concepto_id, solicitud_toma_id?, toma_id?, unidad_id?, fecha_cargo, cancelado_en? | exactamente uno de los tres destinos; importe = concepto_importe vigente en fecha_cargo; única apertura vigente por solicitud |

## Cobranza

| Tabla              | Columnas                                                              | Reglas                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pago`             | id, folio, unidad_id?, caja_id, fecha_hora, clave_idempotencia        | clave única; únicos auxiliares (id, unidad_id) y (id, caja_id). Quien capturó es creado_por; su cargo sale de su cuenta                                                                                                  |
| `pago_mes`         | pago_id, periodo, tarifa_id, con_recargo                              | PK (pago_id, periodo); importe = tarifa × (2 si con_recargo)                                                                                                                                                             |
| `periodo_cubierto` | unidad_id, periodo, pago_id                                           | PK (unidad_id, periodo): un mes pagado una sola vez. FK (pago_id, unidad_id) → pago y (pago_id, periodo) → pago_mes. Al autorizar una cancelación se borran sus filas (único DELETE de cobranza, registrado en bitácora) |
| `pago_concepto`    | pago_id, cargo_extraordinario_id                                      | PK (pago_id, cargo_extraordinario_id); cargo único                                                                                                                                                                                                              |
| `recibo_papel`     | id, pago_id, caja_id, folio_papel, tipo (original, reposicion), fecha | FK (pago_id, caja_id) → pago; único (caja_id, folio_papel); un original por pago (único parcial (pago_id) donde tipo = original)                                                                                                                                         |
| `pago_cancelacion` | id, pago_id, autorizacion_id                                          | trigger: una sola cancelación autorizada por pago                                                                                                                                                                        |

## Cajas

| Tabla           | Columnas                                                                                                                              | Reglas                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caja`          | id, tipo (manzana, comite, apoyo), manzana_id?, custodio_persona_id?                                                                  | manzana obligatoria y única si tipo manzana; custodio obligatorio y único si apoyo; una sola caja comite. El custodio de manzana es su jefe vigente y el de comité el tesorero vigente |
| `saldo_inicial` | caja_id (PK), importe, fecha, autorizacion_id                                                                                         | uno por caja; autorizacion_id único                                                                                                                                                                           |
| `entrega`       | id, folio, caja_origen_id, importe_declarado, fecha, observaciones?, retirada_en?, importe_recibido?, confirmada_en?, confirmada_por? | importe_declarado > 0; no puede estar retirada y confirmada; importe_recibido y confirmada_en van juntos                                                                                                      |
| `aclaracion`    | id, caja_id, entrega_id?, corte_id?, importe (con signo), fecha, autorizacion_id                                                      | exactamente uno de entrega o corte; autorizacion_id único                                                                                                                                                     |

## Comité

| Tabla               | Columnas                                                                                                                          | Reglas                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ingreso`           | id, folio, concepto, importe, fecha, referencia_comprobante?                                                                      | importe > 0                                                                   |
| `categoria_gasto`   | id, nombre, es_salario_fontanero                                                                                                  | nombre único; único parcial donde es_salario_fontanero                                      |
| `gasto`             | id, folio, categoria_id, descripcion, importe?, acuerdo_id?, fecha_pago?, rechazado_en?, motivo_rechazo?, referencia_comprobante? | importe y acuerdo obligatorios salvo pagos al fontanero (salen del salario); motivo_rechazo obligatorio con rechazado_en   |
| `gasto_reintegro`   | id, gasto_id, fecha, autorizacion_id                                                                                              | gasto único; autorizacion_id único                                                                   |
| `fontanero`         | id, nombre, telefono?, activo                                                                                                     |                                                                               |
| `fontanero_salario` | id, fontanero_id, importe, periodicidad (semanal, quincenal, mensual), vigente_desde, acuerdo_id, autorizacion_id                 | importe > 0; autorizacion_id único; único auxiliar (id, fontanero_id)                                             |
| `fontanero_pago`    | gasto_id (PK), fontanero_salario_id, fontanero_id, periodo_inicio                                                                 | FK (fontanero_salario_id, fontanero_id); único (fontanero_id, periodo_inicio) |

## Cortes, autorizaciones y auditoría

| Tabla          | Columnas                                                                                                                                                                                                                                                                      | Reglas                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corte`        | id, folio, caja_id, tipo (mensual, extraordinario), fecha_desde, fecha_hasta, efectivo_contado?, observaciones?, revisado_por?, revisado_en?, cerrado_por?, cerrado_en?                                                                                                       | único parcial (caja_id, fecha_desde) donde mensual. Al cerrar se bloquea el periodo                                                                |
| `autorizacion` | id, tipo (asignacion_cargo, tarifa, salario_fontanero, saldo_inicial, baja_unidad, cambio_titular, cancelacion_pago, aclaracion, reintegro_gasto), motivo, solicitado_por, solicitado_en, resultado? (autorizada, rechazada), resuelto_por?, resuelto_en?, motivo_resolucion? | resultado nulo = pendiente; motivo de resolución obligatorio al rechazar; trigger que verifica que el tipo coincide con la tabla que la referencia |
| `bitacora`     | id, usuario_id, cargo, accion, tabla, registro_id, antes jsonb, despues jsonb, motivo?, es_tecnica, creado_en                                                                                                                                                                 | solo inserción                                                                                                                                     |
| `idempotencia` | clave uuid (PK), usuario_id, ruta, respuesta jsonb, creado_en                                                                                                                                                                                                                 | se depuran las de más de 24 h al consultar                                                                                                         |

## Redundancia intencional

Solo para habilitar restricciones únicas, protegida con FK compuestas: `periodo_cubierto.unidad_id`, `recibo_papel.caja_id` y `fontanero_pago.fontanero_id`.

## Vistas

| Vista                      | Calcula                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v_manzana`                | código S1-M03, jefe vigente y teléfono                                                                                                                  |
| `v_toma`                   | manzana actual, estado (activa, suspendida, baja), número de familias                                                                                   |
| `v_solicitud_toma`         | estado: solicitada, aprobada pendiente de pago, pendiente de instalación, rechazada, cancelada, instalada                                               |
| `v_unidad`                 | titular actual, estado (pendiente de activación, activa, suspendida, baja)                                                                              |
| `v_pago_importe`           | total del pago, manzana y titular en la fecha del pago, receptor, si es de apoyo y si está cancelado                                                    |
| `v_caja_movimiento`        | unión con signo de saldos iniciales, pagos, cancelaciones, entregas confirmadas (salida y entrada), ingresos, gastos pagados, reintegros y aclaraciones |
| `v_saldo_caja`             | saldo esperado por caja                                                                                                                                 |
| `v_entrega`                | estado y diferencia                                                                                                                                     |
| `v_gasto`                  | estado e importe efectivo                                                                                                                               |
| `v_corte`                  | saldo inicial, movimientos por tipo, saldo esperado, diferencia y estado                                                                                |
| `v_autorizacion_pendiente` | bandeja del presidente                                                                                                                                  |

## Reglas que hace cumplir la base de datos

- Un mes pagado una vez por familia (PK de `periodo_cubierto`).
- Un jefe por manzana y una manzana por jefe; un presidente, tesorero y secretario a la vez.
- Una manzana a la vez por toma; un titular a la vez por familia.
- Folio de papel único por caja; homónimos con distintivo; una cuenta por asignación.
- Una tarifa autorizada por mes; una cancelación autorizada por pago; un pago al fontanero por periodo.
- Sin movimientos en meses con corte cerrado (trigger en las tablas de dinero).
- Periodos siempre en día 1.
