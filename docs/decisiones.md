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
| D-28 | Cargos extraordinarios   | Solo el **tesorero** crea un cargo extraordinario (reinstalación, reparación, otro) para una toma o una familia, con el importe vigente del concepto en la fecha del cargo; quien cobra no genera cargos de su propia manzana. El jefe los ve y los cobra con los meses. Un cargo no pagado lo cancela solo el tesorero, con motivo obligatorio y en la bitácora, sin autorización del presidente; nada se borra. La apertura se cobra y se cancela con su solicitud. |

## Cálculo del estado de cuenta (D-01, D-02, D-06, D-25)

Función pura en `packages/shared/src/domain`:

1. Periodos desde `periodo_inicio_cobro` de la unidad hasta el mes en curso (zona `America/Mexico_City`).
2. Quitar los periodos suspendidos (de la unidad o de su toma).
3. Quitar los periodos ya cubiertos; esos muestran la tarifa y el recargo con que se pagaron.
4. Asignar a cada periodo restante la tarifa autorizada vigente en ese mes (la de mayor vigencia menor o igual al mes).
5. Mes en curso = pendiente; meses terminados = vencidos.
6. Con 4 o más vencidos, cada vencido lleva recargo igual a su tarifa base.
7. Agregar anticipos (meses futuros pagados).

Precisiones acordadas al implementarla (paso 5 de la API):

- **Ciclo de adeudo con historia** (D-02): no basta contar los vencidos de hoy. El ciclo se abre al acumular 4 vencidos, sigue abierto aunque haya pagos parciales y solo se cierra cuando la unidad queda sin vencidos. Se reconstruye con la fecha de cada pago: al inicio de cada mes y después de cada pago se cuentan los vencidos. Con el ciclo abierto, **todos** los vencidos llevan recargo; el mes en curso nunca. Los pagos cancelados se ignoran por completo (sus meses vuelven a estar sin pagar).
- **Unidad dada de baja**: se cobra hasta el mes de la baja, completo y sin prorrateo; nada después.
- **Activación a mitad de mes**: ese mes se cobra completo (RF-MEN-02).
- **Mes sin tarifa autorizada**: aparece en el estado de cuenta sin importe y en `periodosSinTarifa`; cuenta como vencido, no suma al adeudo y no se puede cobrar hasta capturar la tarifa.
- **Orden de pago** (D-03, para el paso 6): meses completos desde el más antiguo sin pagar, sin huecos; anticipos solo si la misma operación liquida todo lo pendiente, consecutivos (saltando meses suspendidos) y con la tarifa de su mes, sin recargo.

## Tarifas y cobranza (paso 6 de la API)

Precisiones acordadas al implementarlo:

- **Tarifas pasadas al arranque** (D-05, D-18): una tarifa nueva entra en vigor desde el mes siguiente. Para capturar la historia, se acepta un mes pasado solo si es anterior a la tarifa autorizada más antigua (o cualquiera mientras no haya ninguna autorizada); así nunca cambia el precio de meses que ya tenían tarifa.
- **Importes de conceptos** (D-13): aplican desde hoy o después y no se aceptan si cambiarían cargos ya registrados (el importe de un cargo es el vigente en su fecha).
- **Cancelar un pago** (D-15): al autorizarse, sus meses vuelven a pendiente o vencido y sus cargos extraordinarios se reemiten con la misma fecha y el mismo importe para poder cobrarse otra vez. Un pago que liquidó la apertura de una toma ya instalada no se puede cancelar.
- **Caja receptora** (D-07): la caja de manzana o la de apoyo se crean con su primer cobro si todavía no existen.
- **Bloqueos**: la unidad y la solicitud de toma se bloquean con `SELECT ... FOR UPDATE`. En pago, caja, tarifa y concepto el usuario de la API no tiene UPDATE (el dinero no se edita) y PostgreSQL lo exige para bloquear filas, así que se usa un bloqueo transaccional por registro (`pg_advisory_xact_lock`).

## Cajas y comité (paso 7 de la API)

- **Solicitudes rechazadas** (D-18, RF-GAS-04): una caja tiene un solo saldo inicial y un gasto un solo reintegro, pero una solicitud que PRE rechaza libera el lugar para otra (migraciones 0017 y 0018).
- **Entregas** (D-16): el límite es el saldo esperado menos las entregas pendientes de la misma caja; lo recibido no puede ser mayor que lo declarado.
- **Aclaraciones**: en este paso solo de entregas con diferencia; las de corte, con los cortes (paso 8).
- **Periodos del fontanero** (D-24): semanal de lunes a domingo, quincenal del 1 al 15 y del 16 al último día, mensual el mes natural. Se paga el periodo que contiene la fecha indicada (no futura) con el salario autorizado vigente al inicio del periodo.
- **Caja de manzana**: se crea junto con la manzana.

## Cortes, reportes y auditoría (paso 8 de la API)

- **Cortes mensuales en orden** (D-14): solo de meses terminados; un mes se cierra si el anterior de la caja ya está cerrado (o no hay movimientos antes). Ningún movimiento puede fecharse en o antes del último mes cerrado de su caja, así las cifras de un corte cerrado nunca cambian.
- **Diferencia de un corte**: obligan observaciones al contar, revisar y cerrar; se corrige con una aclaración en el periodo abierto.
- **Sustitución de jefe** (D-08): basta el corte extraordinario contado de la caja de la manzana sin movimientos posteriores; su revisión y cierre siguen el flujo normal.
- **Reportes**: el adeudo es a la fecha de consulta; el resto de las cifras, del rango de meses, con los mismos movimientos que los cortes.

## Permisos (resumen)

| Operación                   | SA      | PRE              | TES      | SEC      | VOC             | JM         |
| --------------------------- | ------- | ---------------- | -------- | -------- | --------------- | ---------- |
| Cuentas de acceso           | sí      | —                | —        | —        | —               | —          |
| Cargos y jefes              | —       | confirma         | —        | registra | —               | —          |
| Secciones y manzanas        | —       | ver              | ver      | sí       | ver             | ver        |
| Personas, tomas, unidades   | —       | ver (para cobrar en apoyo) | ver      | sí       | ver             | su manzana |
| Solicitudes de toma         | —       | ver              | ver      | sí       | ver             | su manzana |
| Acuerdos                    | —       | ver              | ver      | sí       | ver             | —          |
| Baja / cambio de titular    | —       | autoriza         | —        | solicita | —               | solicita   |
| Suspender / reactivar       | —       | sí               | —        | sí       | —               | —          |
| Tarifas y saldos iniciales  | —       | confirma         | registra | ver      | ver             | ver        |
| Cargos extraordinarios      | —       | ver              | crea y cancela | ver | ver             | ver y cobra en su manzana |
| Cobrar                      | —       | en apoyo         | sí       | —        | —               | su manzana |
| Consultar pagos             | —       | sí               | sí       | sí       | sí              | su manzana |
| Reposición de recibo        | —       | —                | sí       | —        | —               | su manzana |
| Cancelar pago               | —       | autoriza         | solicita | —        | —               | solicita   |
| Cajas y movimientos         | —       | sí               | sí       | ver      | ver             | su manzana |
| Entregas                    | —       | ver              | confirma | —        | ver             | prepara    |
| Ingresos, gastos, fontanero | —       | confirma salario | sí       | ver      | ver             | —          |
| Cortes                      | —       | revisa y cierra  | prepara  | ver      | revisa y cierra | prepara    |
| Reporte por manzana         | —       | sí               | sí       | sí       | ver             | su manzana |
| Reporte comunitario         | —       | sí               | sí       | sí       | ver             | —          |
| Bitácora                    | técnica | completa         | —        | —        | —               | —          |
