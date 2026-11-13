# Estructura y convenciones de código

## Monorepo

```
bella-vista-payment-system-api/
├── apps/
│   └── api/                    @bella-vista/api  (Fastify)
├── packages/
│   └── shared/                 @bella-vista/shared  (Zod, reglas puras, formatos)
├── docker/postgres/init/       extensiones y base de pruebas (se ejecutan al crear el volumen)
├── docker-compose.yml          db + api (desarrollo)
├── .devcontainer/              abrir el proyecto dentro del contenedor con VS Code
└── docs/
```

`@bella-vista/shared` no se compila en desarrollo: su `package.json` exporta `src/` con la condición `development` (la usan `tsx`, Vitest y TypeScript) y `dist/` en producción.

## Un módulo de la API

```
apps/api/src/modules/billing/
├── index.ts                    plugin de Fastify: registra las rutas con su prefijo
├── billing.routes.ts           rutas: esquemas Zod de entrada/salida, permisos, llama al servicio
├── billing.service.ts          casos de uso: reglas, transacción, bitácora; no conoce HTTP
├── billing.repository.ts       consultas Drizzle; recibe la transacción como parámetro
└── billing.errors.ts           códigos de error propios del módulo (opcional)
```

Pruebas en `apps/api/test/unit/billing/*.test.ts` (servicio con repositorio simulado) y `apps/api/test/integration/billing/*.test.ts` (contra `DATABASE_URL_TEST`, con `app.inject()`).

Módulos y casos de uso (nombres en inglés según [glosario.md](glosario.md)): auth (CU-01), accounts — cuentas (CU-02), organization — organización (CU-03, CU-04), registry — padrón (CU-05 a CU-07, CU-10, CU-11), connections — tomas (CU-08, CU-09), rates — tarifas (CU-12), billing — cobranza (CU-13 a CU-16), cashboxes — cajas (CU-17, CU-18), committee — comité (CU-19 a CU-21), closings — cortes (CU-22), reports — reportes (CU-23, CU-24), approvals — autorizaciones (transversal), audit — auditoría (CU-25).

## Piezas transversales

| Carpeta                       | Contenido                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `config/`                     | `env.ts`: lee y valida variables con Zod; falla al arrancar si falta algo                       |
| `db/`                         | `client.ts` (conexión `postgres` + Drizzle), `schema/` por dominio, `migrations/`               |
| `plugins/`                    | autenticación JWT y permisos, manejador de errores, idempotencia, contexto de bitácora          |
| `lib/`                        | `AppError`, dinero en centavos, periodos `AAAA-MM`, zona horaria                                |
| `packages/shared/src/domain`  | estado de cuenta, recargos, orden de pago, tarifa vigente: funciones puras con pruebas de tabla |
| `packages/shared/src/schemas` | esquemas Zod del contrato de `docs/api.md`                                                      |
| `packages/shared/src/format`  | `$1,234.00`, "Junio 2026", fechas es-MX                                                         |

## Convenciones

- Archivos en `kebab-case`; tipos en `PascalCase`; funciones y variables en `camelCase`; tablas y columnas en `snake_case` (Drizzle mapea a camelCase en TS).
- Código, comentarios, identificadores, tablas, rutas y commits en inglés, con los nombres de [glosario.md](glosario.md) (payment, cashbox, unit). Los mensajes que ve el usuario siguen en español.
- Imports relativos con `.js`; imports de tipos con `import type`.
- Toda función del dominio recibe el "ahora" como parámetro (sin `new Date()` interno) para poder probarla.
- Cada endpoint declara su esquema de respuesta: Fastify no envía campos que no estén en él.

## Plan de implementación

Fuente: documento 3.1 de Notion. **Antes de cada bloque, revisa 3.1 en Notion; si difiere de `docs/`, manda Notion** y se actualiza `docs/` en un commit `docs` aparte.

### Cómo se trabaja cada bloque

1. Leer 3.1, 2.2 Modelo de datos y 2.3 Contrato de API, y sincronizar `docs/` si difiere.
2. Proponer el plan (modo plan) y esperar revisión.
3. Implementar el bloque completo: esquema Drizzle, migración generada y migración SQL escrita a mano para lo que Drizzle no expresa (CHECK, índices parciales sobre expresiones, triggers, permisos).
4. Aplicar con `pnpm db:migrate` y escribir pruebas de integración que demuestren que la base rechaza los datos inválidos del bloque.
5. `pnpm check` en verde.
6. Commit según `CONTRIBUTING.md` (alcance `db` para esquema y migraciones), solo después de la revisión del usuario.

**Terminado:** migraciones aplicadas desde cero sin errores (`pnpm docker:reset-db` o base de pruebas vacía), pruebas de restricciones en verde, `docs/` sincronizado y commit hecho.

### Base de datos

| Bloque | Tablas | Pruebas mínimas de restricciones | Estado |
| --- | --- | --- | --- |
| 1. Organización y acceso | seccion, manzana, persona, acuerdo, autorizacion, asignacion_cargo, usuario, token_refresco + `f_normalizar` | Homónimo sin distintivo; dos jefes vigentes en una manzana; una persona jefe de dos manzanas; dos presidentes vigentes; dos cuentas para la misma asignación | **Hecho** |
| 2. Padrón y tomas | solicitud_toma, toma, toma_manzana, unidad, unidad_titular, suspension, solicitud_cambio_unidad | Dos manzanas vigentes para una toma; dos titulares vigentes en una unidad; suspensión con toma y unidad a la vez (o ninguna); unidad activada sin periodo_inicio_cobro; periodo que no es día 1 | Pendiente |
| 3. Tarifas y conceptos | tarifa, concepto, concepto_importe, cargo_extraordinario | Cargo extraordinario con más de un destino; dos aperturas vigentes para la misma solicitud; tarifa con importe 0 | Pendiente |
| 4. Cajas y cobranza | caja, saldo_inicial, pago, pago_mes, periodo_cubierto, pago_concepto, recibo_papel, pago_cancelacion | Mismo mes pagado dos veces en una unidad; folio de papel repetido en la misma caja; dos recibos originales para un pago; segunda caja del comité; caja de manzana sin manzana; misma clave de idempotencia | Pendiente |
| 5. Entregas y comité | entrega, ingreso, categoria_gasto, gasto, gasto_reintegro, fontanero, fontanero_salario, fontanero_pago | Entrega retirada y confirmada a la vez; dos categorías de salario del fontanero; mismo periodo del fontanero pagado dos veces | Pendiente |
| 6. Cortes y control | corte, aclaracion, bitacora, idempotencia | Dos cortes mensuales de la misma caja y mes; aclaración ligada a entrega y corte a la vez | Pendiente |
| 7. Vistas, triggers y permisos | Vistas de [modelo-datos.md](modelo-datos.md#vistas); triggers; usuario de BD de la API | Ver abajo | Pendiente |
| 8. Arranque inicial | Script `pnpm db:seed` (D-27) y datos de desarrollo `pnpm db:seed:dev` | Ver abajo | Pendiente |

**Por qué este orden:** `pago` apunta a `caja`, así que la caja va en el bloque 4 con la cobranza; `aclaracion` apunta a `corte`, así que va en el bloque 6; las vistas necesitan todas las tablas.

**Bloque 7 — vistas, triggers y permisos.**

- Vistas: v_manzana, v_toma, v_solicitud_toma, v_unidad, v_pago_importe, v_caja_movimiento, v_saldo_caja, v_entrega, v_gasto, v_corte, v_autorizacion_pendiente; cada una con una prueba que compruebe su resultado con datos conocidos.
- Triggers: periodo cerrado (rechaza inserciones en tablas de dinero con fecha dentro de un mes con corte cerrado de la misma caja, D-14); una sola tarifa autorizada por `periodo_vigencia`; una sola cancelación autorizada por pago; el `tipo` de la autorización coincide con la tabla que la referencia.
- Usuarios de BD `agua` y `agua_api` (ver [modelo-datos.md](modelo-datos.md#usuarios-de-base-de-datos)). En desarrollo, `agua_api` lo crea un script nuevo en `docker/postgres/init/` y los permisos los otorga una migración. Hay que agregar `DATABASE_URL_MIGRACIONES` a `.env.example`, `docker-compose.yml` y `drizzle.config.ts`. Prueba obligatoria: con `agua_api`, un UPDATE o DELETE sobre `pago` falla.

**Bloque 8 — arranque inicial (D-27).** Como no hay registro público (D-19) y la asignación del primer presidente necesitaría que un presidente la confirme, el sistema arranca con `pnpm db:seed`, que se ejecuta una sola vez:

- Lee `arranque.json`, que **no se versiona** (solo `arranque.example.json`): nombre y usuario del superadministrador; presidente, tesorero y secretario con fecha de inicio; datos del acuerdo de la junta que los eligió.
- En una transacción crea:
  - La persona, la asignación `superadmin` y su cuenta con una contraseña temporal que se imprime una sola vez (debe cambiarla al entrar).
  - El acuerdo de elección y las asignaciones de presidente, tesorero y secretario con su autorización **autorizada por arranque** (resuelta por el superadministrador, motivo con el folio del acuerdo). Sus cuentas las crea después el superadministrador desde la app.
  - La caja del comité, las categorías de gasto (electricidad, reparaciones, materiales, instalaciones, salario del fontanero, otros) y los conceptos (apertura de toma, reinstalación, reparación a usuario) sin importe; el tesorero captura los importes desde la app.
  - Registros técnicos en la bitácora.
- Si ya existe un superadministrador, no hace nada y lo informa.
- `pnpm db:seed:dev` carga datos de desarrollo (secciones, manzanas, jefes, homónimos, tomas con varias familias, tarifas históricas y algunos pagos) y se niega a ejecutarse si `NODE_ENV=production`.

### API

| Paso | Contenido | Pruebas clave |
| --- | --- | --- |
| 1. Base | `app.ts` separado de `server.ts`; manejador de errores con `{ error: { codigo, mensaje, detalles } }`; `/health` que consulta la base; plugin de autenticación y permisos (cargo de la cuenta + manzana + vigencia); plugin de idempotencia; contexto de bitácora | Error de validación con formato correcto; `/health` falla si la base no responde |
| 2. auth y cuentas | Login, refresco rotativo, salir, cambio de contraseña obligatorio, bloqueo tras 5 intentos; alta de cuenta por el SA para una asignación sin cuenta, restablecer, bloquear, desactivar | Reutilizar un token de refresco revoca la familia; cargo cerrado no entra; nadie más que el SA crea cuentas |
| 3. organización y autorizaciones | Secciones, manzanas, asignaciones (con autorización), sustitución de jefe; bandeja y resolución | Un jefe por manzana; solo PRE resuelve |
| 4. padrón y tomas | Búsqueda, homónimos, personas, tomas preexistentes, unidades, suspensiones, solicitudes, acuerdos, activación | JM no ve pagos de otra manzana; familia en toma no activa rechazada |
| 5. Estado de cuenta (`packages/shared/src/domain`) | Función pura (ver [decisiones.md](decisiones.md#cálculo-del-estado-de-cuenta-d-01-d-02-d-06-d-25)) | Pruebas de tabla: D-01, D-02 (pago parcial con recargo), D-03, D-05, D-06, cambio de tarifa, anticipos, mes en curso |
| 6. tarifas y cobranza | Tarifas y conceptos; previsualizar, registrar pago, reposición, cancelación | Idempotencia; TOTAL_CAMBIO; orden de meses; folio repetido; doble pago concurrente |
| 7. cajas y comité | Saldos, entregas, aclaraciones; ingresos, gastos, fontanero | Entrega mayor al saldo; gasto sin saldo; periodo del fontanero repetido |
| 8. cortes, reportes, auditoría | Cortes y cierre de periodo; datos de los dos reportes; bitácora | Movimiento en mes cerrado rechazado; totales del reporte comunitario cuadran con los cortes |
