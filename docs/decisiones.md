# Reglas de negocio confirmadas

Fuente: documento 1.1 de Notion, sección 2. Todas están confirmadas por el comité o aceptadas.

| #    | Tema                     | Regla                                                                                                                                                                                                                   |
| ---- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Pendiente y vencida      | La mensualidad del mes en curso es **pendiente**; al terminar su mes pasa a **vencida**. El recargo solo cuenta vencidas.                                                                                               |
| D-02 | Fin del ciclo de adeudo  | El ciclo termina solo cuando la unidad queda **sin vencidas**. Pagar algunos meses no quita el recargo de los demás. Ej.: 4 meses de $50 → $400; paga 2 → $200; los 2 restantes siguen a $100.                          |
| D-03 | Orden de pago            | Se paga en orden cronológico desde el vencido más antiguo, sin huecos. Los anticipos (meses futuros) solo sin pendientes o en la misma operación que los liquida.                                                       |
| D-04 | Recargo                  | Automático por regla, sin aprobación. Sin condonaciones en v1.                                                                                                                                                          |
| D-05 | Anticipos y tarifas      | Un mes futuro se cobra con la tarifa aprobada para ese mes. Una tarifa nueva solo entra en vigor desde el mes siguiente a su registro. Lo pagado no se recalcula.                                                       |
| D-06 | Suspensión               | Una toma suspendida no genera mensualidades para ninguna de sus unidades; una unidad suspendida tampoco. Los adeudos previos se conservan.                                                                              |
| D-07 | Cobro en apoyo           | El cobro entra a la caja de quien recibe el efectivo. Quien cobra en apoyo tiene una caja de apoyo que entrega al tesorero.                                                                                             |
| D-08 | Sustitución de jefe      | La caja es de la manzana. Al cambiar de jefe se exige acta de entrega (corte extraordinario con conteo); el nuevo jefe recibe ese saldo.                                                                                |
| D-09 | Jefes                    | Un solo jefe por manzana y una persona solo puede ser jefe de una manzana.                                                                                                                                              |
| D-10 | Homónimos                | Sin CURP. Si existe el mismo nombre y es otra persona, se exige un distintivo (por defecto la clave de manzana, o una referencia corta). Nombre + distintivo es único.                                                  |
| D-11 | Cambio de titular        | El adeudo se queda en la unidad; el historial guarda qué titular había en cada periodo.                                                                                                                                 |
| D-12 | Solicitudes de toma      | Estados adicionales: Rechazada y Cancelada.                                                                                                                                                                             |
| D-13 | Cuota de apertura        | Catálogo con historial; el importe se fija al aprobar la solicitud.                                                                                                                                                     |
| D-14 | Periodo cerrado          | Un mes con corte cerrado no admite movimientos con fecha en ese mes; las correcciones van al periodo abierto con referencia al original.                                                                                |
| D-15 | Cancelar pago            | Contramovimiento en la caja receptora y meses de vuelta a pendiente o vencido. Lo autoriza PRE con motivo.                                                                                                              |
| D-16 | Faltante en entrega      | La caja del jefe solo baja por el importe recibido; el faltante queda en su caja hasta una aclaración autorizada.                                                                                                       |
| D-17 | Gastos                   | Todo gasto requiere acuerdo de junta. El salario del fontanero queda cubierto por el acuerdo que lo fijó.                                                                                                               |
| D-18 | Arranque                 | Captura manual: por cada unidad existente se registra su primer mes pendiente según la libreta; la deuda se calcula con tarifas históricas. TES captura tarifas pasadas y el saldo inicial de cada caja (PRE confirma). |
| D-19 | Cuentas                  | **Sin registro público.** Solo el SA crea cuentas, para asignaciones de cargo vigentes (SEC registra, PRE confirma), y entrega usuario y contraseña temporal en persona. El SA nunca asigna cargos.                     |
| D-20 | Registro de tarifa       | TES la registra con su acuerdo; PRE la confirma.                                                                                                                                                                        |
| D-21 | Caja sin negativos       | No se paga un gasto que exceda el saldo esperado de la caja del comité.                                                                                                                                                 |
| D-22 | Una cuenta, un cargo     | Cada cuenta está ligada a una sola asignación; el cargo no se elige ni se cambia en la app. Quien tiene dos cargos recibe dos cuentas. Al cerrarse la asignación, la cuenta se desactiva.                               |
| D-23 | Recibos                  | De papel, llenados a mano. La app registra el pago y el folio del recibo de papel (obligatorio, único por caja). Reposición por extravío sin costo, con nuevo folio ligado al pago.                                     |
| D-24 | Fontanero                | No usa la app. Salario fijo con historial, periodicidad y acuerdo; cada pago es un gasto de la caja del comité; un periodo se paga una sola vez.                                                                        |
| D-25 | Sin procesos programados | Mensualidades, vencimientos y recargos **se calculan al consultar**. Al pagar, la tarifa y el recargo quedan fijos en el pago.                                                                                          |
| D-26 | Sin archivos             | No se suben fotos ni documentos; comprobantes y actas son referencias de texto.                                                                                                                                         |
| D-27 | Arranque inicial         | El sistema se inicializa **una sola vez** con un script técnico (`pnpm db:seed`) que crea la cuenta del SA (contraseña temporal), registra a PRE, TES y SEC elegidos en junta con su acuerdo como **autorizados por arranque**, y crea la caja del comité, las categorías de gasto y los conceptos sin importe. Después todo entra por los flujos normales de la app. Detalle en 3.1 ([estructura.md](estructura.md#plan-de-implementación)). |

## Cálculo del estado de cuenta (D-01, D-02, D-06, D-25)

Función pura en `packages/shared/src/domain`:

1. Periodos desde `periodo_inicio_cobro` de la unidad hasta el mes en curso (zona `America/Mexico_City`).
2. Quitar los periodos suspendidos (de la unidad o de su toma).
3. Quitar los periodos ya cubiertos; esos muestran la tarifa y el recargo con que se pagaron.
4. Asignar a cada periodo restante la tarifa autorizada vigente en ese mes (la de mayor vigencia menor o igual al mes).
5. Mes en curso = pendiente; meses terminados = vencidos.
6. Con 4 o más vencidos, cada vencido lleva recargo igual a su tarifa base.
7. Agregar anticipos (meses futuros pagados).

## Permisos (resumen)

| Operación                   | SA      | PRE              | TES      | SEC      | VOC             | JM         |
| --------------------------- | ------- | ---------------- | -------- | -------- | --------------- | ---------- |
| Cuentas de acceso           | sí      | —                | —        | —        | —               | —          |
| Cargos y jefes              | —       | confirma         | —        | registra | —               | —          |
| Secciones y manzanas        | —       | ver              | ver      | sí       | ver             | ver        |
| Personas, tomas, unidades   | —       | apoyo            | ver      | sí       | ver             | su manzana |
| Solicitudes de toma         | —       | ver              | ver      | sí       | ver             | su manzana |
| Acuerdos                    | —       | ver              | ver      | sí       | ver             | —          |
| Baja / cambio de titular    | —       | autoriza         | —        | solicita | —               | solicita   |
| Suspender / reactivar       | —       | sí               | —        | sí       | —               | —          |
| Tarifas y saldos iniciales  | —       | confirma         | registra | ver      | ver             | ver        |
| Cobrar                      | —       | en apoyo         | sí       | —        | —               | su manzana |
| Reposición de recibo        | —       | —                | sí       | —        | —               | su manzana |
| Cancelar pago               | —       | autoriza         | solicita | —        | —               | solicita   |
| Entregas                    | —       | ver              | confirma | —        | ver             | prepara    |
| Ingresos, gastos, fontanero | —       | confirma salario | sí       | ver      | ver             | —          |
| Cortes                      | —       | revisa y cierra  | prepara  | ver      | revisa y cierra | prepara    |
| Reporte por manzana         | —       | sí               | sí       | sí       | ver             | su manzana |
| Reporte comunitario         | —       | sí               | sí       | sí       | ver             | —          |
| Bitácora                    | técnica | completa         | —        | —        | —               | —          |
