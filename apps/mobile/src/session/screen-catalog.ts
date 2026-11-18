import { ROLES, type Role } from '@bella-vista/shared';

// Screen catalog (3.2 §10 and §11.1): the 63 screens of the app with their Figma/2.5 ID, route
// (relative to app/, in English) and Spanish title, and whether the screen is built. role-menu.ts
// takes its routes from here, and test/session/screen-catalog.test.ts checks that every screen
// marked as done has its file in app/ with the ID comment on its first line
// (e.g. "// F-02 · Elegir meses").
//
// `<role>` in a route stands for each role folder (the exact value of ROLES): C-04 "Más" exists
// once per role. Mark `done: true` in the commit that builds the screen.

export type Phase = 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8';

export type ScreenEntry = {
  id: string;
  title: string;
  route: string;
  phase: Phase;
  done: boolean;
};

const screen = (id: string, title: string, route: string, phase: Phase, done = false) =>
  ({ id, title, route, phase, done }) as const satisfies ScreenEntry;

export const SCREENS = [
  // 10.1 Sesión y comunes
  screen('C-01', 'Iniciar sesión', '(auth)/sign-in', 'M2', true),
  screen('C-02', 'Nueva contraseña', '(auth)/new-password', 'M2', true),
  screen('C-04', 'Más', '(app)/<role>/more', 'M2', true),
  screen('C-05', 'Perfil', '(app)/common/profile', 'M2', true),
  // 10.2 Compartidas
  screen('G-01', 'Buscar', '(app)/common/search', 'M5', true),
  screen('G-02', 'Ficha de persona', '(app)/common/people/[id]', 'M5', true),
  screen('G-03', 'Ficha de toma', '(app)/common/connections/[id]', 'M5', true),
  screen('G-04', 'Familia (estado de cuenta)', '(app)/common/units/[id]', 'M6', true),
  screen('G-05', 'Detalle de pago', '(app)/common/payments/[id]', 'M6', true),
  screen('G-06', 'Reporte de padrón por manzana', '(app)/common/reports/block', 'M8'),
  screen('G-07', 'Reporte comunitario', '(app)/common/reports/community', 'M8'),
  screen('G-08', 'Corte (detalle)', '(app)/common/closings/[id]', 'M8'),
  screen('G-09', 'Caja (saldo y movimientos)', '(app)/common/cashboxes/[id]', 'M7', true),
  screen('G-10', 'Reposición de recibo', '(app)/common/payments/[id]/replacement', 'M6', true),
  screen('G-11', 'Solicitud con motivo', '(app)/common/approval-request', 'M4', true),
  // 10.3 Flujo de cobro
  screen('F-01', 'Buscar familia', '(app)/common/new-payment/search', 'M6', true),
  screen('F-02', 'Elegir meses', '(app)/common/new-payment/months', 'M6', true),
  screen('F-03', 'Revisar y folio', '(app)/common/new-payment/review', 'M6', true),
  screen('F-04', 'Pago registrado', '(app)/common/new-payment/done', 'M6', true),
  // 10.4 Padrón
  screen('P-01', 'Lista del padrón', '(app)/common/registry', 'M5', true),
  screen('P-02', 'Registrar persona', '(app)/common/registry/new-person', 'M5', true),
  screen(
    'P-03',
    'Registrar toma y familia existentes',
    '(app)/common/registry/pre-existing-connection',
    'M5',
    true,
  ),
  screen('P-04', 'Agregar familia a toma', '(app)/common/connections/[id]/add-unit', 'M5', true),
  screen(
    'P-05',
    'Nueva solicitud de toma',
    '(app)/common/registry/new-connection-request',
    'M5',
    true,
  ),
  screen(
    'P-06',
    'Registrar instalación y activación',
    '(app)/common/connection-requests/[id]/activate',
    'M5',
    true,
  ),
  // 10.5 Jefe de manzana
  screen('J-01', 'Inicio', '(app)/block_leader/home', 'M6', true),
  screen('J-02', 'Mi caja', '(app)/block_leader/my-cashbox', 'M7', true),
  screen('J-03', 'Preparar entrega', '(app)/block_leader/my-cashbox/new-handover', 'M7', true),
  screen('J-04', 'Mis entregas', '(app)/block_leader/my-cashbox/handovers', 'M7', true),
  screen('J-05', 'Corte del mes', '(app)/block_leader/my-cashbox/closing', 'M8'),
  screen(
    'J-06',
    'Mis solicitudes de toma',
    '(app)/block_leader/more/connection-requests',
    'M5',
    true,
  ),
  // 10.6 Tesorero
  screen('T-01', 'Inicio', '(app)/treasurer/home', 'M7', true),
  screen('T-02', 'Entregas por confirmar', '(app)/treasurer/handovers', 'M7', true),
  screen('T-03', 'Confirmar entrega', '(app)/treasurer/handovers/[id]', 'M7', true),
  screen('T-04', 'Caja del comité', '(app)/treasurer/cashbox', 'M7', true),
  screen('T-05', 'Registrar ingreso', '(app)/treasurer/cashbox/new-income', 'M7', true),
  screen('T-06', 'Registrar gasto', '(app)/treasurer/cashbox/new-expense', 'M7', true),
  screen('T-07', 'Detalle de gasto', '(app)/treasurer/cashbox/expenses/[id]', 'M7', true),
  screen('T-08', 'Fontanero', '(app)/treasurer/more/plumber', 'M7', true),
  screen('T-09', 'Pagar al fontanero', '(app)/treasurer/more/plumber/pay', 'M7', true),
  screen('T-10', 'Tarifas', '(app)/treasurer/more/rates', 'M6', true),
  screen('T-11', 'Conceptos y cuota de apertura', '(app)/treasurer/more/fees', 'M6', true),
  screen('T-12', 'Saldos iniciales', '(app)/treasurer/more/opening-balances', 'M7', true),
  screen('T-13', 'Cortes', '(app)/treasurer/more/closings', 'M8'),
  // 10.7 Secretario
  screen('S-01', 'Inicio', '(app)/secretary/home', 'M4', true),
  screen('S-02', 'Solicitudes de toma', '(app)/secretary/connection-requests', 'M5', true),
  screen(
    'S-03',
    'Resolver solicitud',
    '(app)/secretary/connection-requests/[id]/resolve',
    'M5',
    true,
  ),
  screen('S-04', 'Acuerdos', '(app)/secretary/more/agreements', 'M5', true),
  screen('S-05', 'Registrar acuerdo', '(app)/secretary/more/agreements/new', 'M5', true),
  screen('S-06', 'Organización', '(app)/secretary/organization', 'M4', true),
  screen('S-07', 'Cargos y jefes', '(app)/secretary/organization/role-assignments', 'M4', true),
  screen('S-08', 'Suspensiones', '(app)/secretary/more/suspensions', 'M5', true),
  // 10.8 Presidente, vocal y superadministrador
  screen('R-01', 'Inicio del presidente', '(app)/president/home', 'M4', true),
  screen('R-02', 'Autorizaciones', '(app)/president/approvals', 'M4', true),
  screen('R-03', 'Detalle de autorización', '(app)/president/approvals/[id]', 'M4', true),
  screen('R-04', 'Cortes por revisar', '(app)/president/closings', 'M8'),
  screen('R-05', 'Bitácora', '(app)/president/more/audit-log', 'M8'),
  screen('R-06', 'Mi caja de apoyo', '(app)/president/more/support-cashbox', 'M7', true),
  screen('V-01', 'Inicio del vocal', '(app)/member/home', 'M8'),
  screen('A-01', 'Cuentas', '(app)/superadmin/accounts', 'M3', true),
  screen('A-02', 'Crear cuenta', '(app)/superadmin/accounts/new', 'M3', true),
  screen('A-03', 'Detalle de cuenta', '(app)/superadmin/accounts/[id]', 'M3', true),
  screen('A-04', 'Bitácora técnica', '(app)/superadmin/audit-log', 'M3', true),
] as const;

export type ScreenId = (typeof SCREENS)[number]['id'];

const BY_ID = new Map<string, ScreenEntry>(SCREENS.map((entry) => [entry.id, entry]));

export function screenById(id: ScreenId): ScreenEntry;
export function screenById(id: string): ScreenEntry | undefined;
export function screenById(id: string): ScreenEntry | undefined {
  return BY_ID.get(id);
}

export function isScreenId(id: string): id is ScreenId {
  return BY_ID.has(id);
}

/**
 * The route files of a screen, relative to app/ and without extension: one per role when the
 * route has `<role>`, otherwise one.
 */
export function routeFiles(entry: ScreenEntry): string[] {
  return entry.route.includes('<role>')
    ? ROLES.map((role) => entry.route.replace('<role>', role))
    : [entry.route];
}

/** URL of a screen: the route without its groups, e.g. "/block_leader/more". */
export function screenHref(entry: ScreenEntry, role?: Role): string {
  const route = role ? entry.route.replace('<role>', role) : entry.route;
  return `/${route
    .split('/')
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join('/')}`;
}
