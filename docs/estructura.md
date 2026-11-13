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

## Orden sugerido de desarrollo

1. Base: `config/env.ts`, cliente de BD, `AppError` y manejador de errores, `/health` con verificación de BD, `app.ts` separado de `server.ts` para las pruebas.
2. Esquema de BD por bloques con sus migraciones: organización y acceso → padrón y tomas → tarifas → cobranza → cajas → comité → cortes, autorizaciones y bitácora → vistas y triggers.
3. `auth` y `accounts` (login, refresco, cambio de contraseña, alta por SA) con permisos.
4. `organization`, `approvals` (bandeja), `registry`, `connections`.
5. `rates` y la función de estado de cuenta en `shared/domain` con pruebas exhaustivas (D-01 a D-06).
6. `billing` (previsualizar, pagar, reposición, cancelación) con idempotencia.
7. `cashboxes` (saldos, entregas, aclaraciones), `committee` (ingresos, gastos, fontanero).
8. `closings`, `reports`, `audit`.
