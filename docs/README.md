# Documentación

Resumen del análisis (Fase 1) y del diseño (Fase 2) necesario para programar la API. La versión completa y vigente está en Notion; si algo no coincide, manda Notion y hay que actualizar estos archivos.

| Archivo                            | Contenido                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| [decisiones.md](decisiones.md)     | Reglas de negocio confirmadas por el comité (D-01 a D-26). **Leer primero.** |
| [modelo-datos.md](modelo-datos.md) | Tablas, columnas, restricciones y vistas de PostgreSQL                       |
| [api.md](api.md)                   | Convenciones, endpoints, permisos y códigos de error                         |
| [estructura.md](estructura.md)     | Cómo se organiza un módulo, convenciones de código y orden de desarrollo     |
| [glosario.md](glosario.md)         | Traducción español → inglés de módulos, tablas, columnas y enums para el código |

## Documentos en Notion

- Proyecto: Sistema de cobro de agua-Bella Vista — https://app.notion.com/p/404088c27ae0800a8f58db8b91f584c9
- 1.1 Requerimientos funcionales y no funcionales — https://app.notion.com/p/405088c27ae08107b42ac6153f224386
- 1.2 Historias de usuario — https://app.notion.com/p/405088c27ae081489db2f3c88473b6a1
- 1.3 Casos de uso — https://app.notion.com/p/405088c27ae081e38effc7e90ea9106e
- 2.1 Arquitectura — https://app.notion.com/p/405088c27ae081569ea4fd515b1a6858
- 2.2 Modelo de datos — https://app.notion.com/p/405088c27ae081e5952aee5d462fdcb5
- 2.3 Contrato de API — https://app.notion.com/p/405088c27ae0813da0bfd664dc026068
- Diseño en Figma — https://www.figma.com/design/O3K6EY21ZnlCkMPohvvaJp

## Glosario

- **Toma:** conexión física instalada; pertenece a una manzana.
- **Unidad (en pantalla, "familia"):** hogar que paga una mensualidad completa; ligada a una toma. Una toma puede tener varias.
- **Caja:** efectivo bajo custodia: de manzana (jefe), del comité (tesorero) o de apoyo (miembro del comité que cobra en apoyo). Su saldo se calcula, nunca se edita.
- **Ciclo de adeudo:** desde que una unidad junta 4 mensualidades vencidas hasta que queda sin vencidas; mientras dura, cada vencida paga el doble.
- **Corte:** cierre mensual de una caja: saldo esperado, efectivo contado y diferencia.
- **Distintivo:** dato que diferencia a dos personas con el mismo nombre.
- Roles: **SA** superadministrador, **PRE** presidente, **TES** tesorero, **SEC** secretario, **VOC** vocal, **JM** jefe de manzana.
