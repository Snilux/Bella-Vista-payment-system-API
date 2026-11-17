import type { Action, Role } from '@bella-vista/shared';
import type { IconName } from '../ui/Icon.js';
import { type ScreenEntry, type ScreenId, screenById, screenHref } from './screen-catalog.js';

// Menú y pestañas por cargo (2.5 §1; 3.2 §11.1): one table role → tabs → "Más" options. The role
// is the route segment as it is in ROLES (app/(app)/<role>/…), with no conversion. Each account
// has one role (D-22), so its tab bar never changes.
//
// A tab is a file app/(app)/<role>/<name>.tsx (or a folder with index.tsx). `screen` is the
// screen it shows: its own (J-01) or a shared one of common/ that the tab file re-exports
// (Cobrar → F-01). Until that screen is built the tab file shows "Próximamente" with the ID.
// `action` (when present) is the permission of @bella-vista/shared the option needs: the menu
// hides what the role cannot do, and a test checks the table and the permissions agree.

export type RoleTab = {
  name: string;
  label: string;
  icon: IconName;
  screen: ScreenId;
  action?: Action;
};

export type MoreOption = {
  label: string;
  icon: IconName;
  screen: ScreenId;
  action?: Action;
};

export type RoleMenu = {
  tabs: readonly RoleTab[];
  more: readonly MoreOption[];
};

const MORE_TAB: RoleTab = { name: 'more', label: 'Más', icon: 'menu', screen: 'C-04' };
const PROFILE: MoreOption = { label: 'Perfil', icon: 'profile', screen: 'C-05' };
/** "Reportes" opens the community report (G-07), which links to the block report (G-06). */
const REPORTS: MoreOption = {
  label: 'Reportes',
  icon: 'report',
  screen: 'G-07',
  action: 'reports.community',
};
const REGISTRY_LOOKUP: MoreOption = {
  label: 'Padrón (consulta)',
  icon: 'people',
  screen: 'P-01',
  action: 'registry.view',
};

export const ROLE_MENU: Record<Role, RoleMenu> = {
  block_leader: {
    tabs: [
      { name: 'home', label: 'Inicio', icon: 'home', screen: 'J-01' },
      {
        name: 'new-payment',
        label: 'Cobrar',
        icon: 'cash',
        screen: 'F-01',
        action: 'billing.collect',
      },
      {
        name: 'registry',
        label: 'Padrón',
        icon: 'people',
        screen: 'P-01',
        action: 'registry.view',
      },
      {
        name: 'my-cashbox',
        label: 'Mi caja',
        icon: 'wallet',
        screen: 'J-02',
        action: 'cashboxes.view',
      },
      MORE_TAB,
    ],
    more: [
      {
        label: 'Solicitudes de toma',
        icon: 'connection',
        screen: 'J-06',
        action: 'connectionRequests.view',
      },
      {
        label: 'Reporte de mi manzana',
        icon: 'report',
        screen: 'G-06',
        action: 'reports.block',
      },
      PROFILE,
    ],
  },
  treasurer: {
    tabs: [
      { name: 'home', label: 'Inicio', icon: 'home', screen: 'T-01' },
      {
        name: 'handovers',
        label: 'Entregas',
        icon: 'handover',
        screen: 'T-02',
        action: 'handovers.confirm',
      },
      {
        name: 'cashbox',
        label: 'Caja',
        icon: 'wallet',
        screen: 'T-04',
        action: 'committee.manage',
      },
      {
        name: 'new-payment',
        label: 'Cobrar',
        icon: 'cash',
        screen: 'F-01',
        action: 'billing.collect',
      },
      MORE_TAB,
    ],
    more: [
      { label: 'Fontanero', icon: 'plumber', screen: 'T-08', action: 'committee.manage' },
      { label: 'Tarifas', icon: 'rate', screen: 'T-10', action: 'rates.register' },
      { label: 'Conceptos', icon: 'fees', screen: 'T-11', action: 'rates.register' },
      {
        label: 'Saldos iniciales',
        icon: 'wallet',
        screen: 'T-12',
        action: 'openingBalances.register',
      },
      { label: 'Cortes', icon: 'closing', screen: 'T-13', action: 'closings.prepare' },
      REPORTS,
      PROFILE,
    ],
  },
  secretary: {
    tabs: [
      { name: 'home', label: 'Inicio', icon: 'home', screen: 'S-01' },
      {
        name: 'registry',
        label: 'Padrón',
        icon: 'people',
        screen: 'P-01',
        action: 'registry.manage',
      },
      {
        name: 'connection-requests',
        label: 'Tomas',
        icon: 'connection',
        screen: 'S-02',
        action: 'connectionRequests.resolve',
      },
      {
        name: 'organization',
        label: 'Organización',
        icon: 'organization',
        screen: 'S-06',
        action: 'organization.manage',
      },
      MORE_TAB,
    ],
    more: [
      { label: 'Acuerdos', icon: 'agreement', screen: 'S-04', action: 'agreements.manage' },
      {
        label: 'Suspensiones',
        icon: 'suspension',
        screen: 'S-08',
        action: 'suspensions.manage',
      },
      REPORTS,
      PROFILE,
    ],
  },
  president: {
    tabs: [
      { name: 'home', label: 'Inicio', icon: 'home', screen: 'R-01' },
      {
        name: 'approvals',
        label: 'Autorizaciones',
        icon: 'approvals',
        screen: 'R-02',
        action: 'approvals.resolve',
      },
      {
        name: 'closings',
        label: 'Cortes',
        icon: 'closing',
        screen: 'R-04',
        action: 'closings.review',
      },
      {
        name: 'reports',
        label: 'Reportes',
        icon: 'report',
        screen: 'G-07',
        action: 'reports.community',
      },
      MORE_TAB,
    ],
    more: [
      { label: 'Cobrar en apoyo', icon: 'cash', screen: 'F-01', action: 'billing.collect' },
      {
        label: 'Mi caja de apoyo',
        icon: 'wallet',
        screen: 'R-06',
        action: 'handovers.prepare',
      },
      REGISTRY_LOOKUP,
      { label: 'Bitácora', icon: 'auditLog', screen: 'R-05', action: 'auditLog.view' },
      PROFILE,
    ],
  },
  member: {
    tabs: [
      { name: 'home', label: 'Inicio', icon: 'home', screen: 'V-01' },
      {
        name: 'closings',
        label: 'Cortes',
        icon: 'closing',
        screen: 'R-04',
        action: 'closings.review',
      },
      {
        name: 'reports',
        label: 'Reportes',
        icon: 'report',
        screen: 'G-07',
        action: 'reports.community',
      },
      MORE_TAB,
    ],
    more: [REGISTRY_LOOKUP, PROFILE],
  },
  superadmin: {
    tabs: [
      {
        name: 'accounts',
        label: 'Cuentas',
        icon: 'accounts',
        screen: 'A-01',
        action: 'accounts.manage',
      },
      {
        name: 'audit-log',
        label: 'Bitácora',
        icon: 'auditLog',
        screen: 'A-04',
        action: 'auditLog.view',
      },
      MORE_TAB,
    ],
    more: [PROFILE],
  },
};

/** URL of a tab of the role, e.g. "/block_leader/home". */
export function tabHref(role: Role, tab: RoleTab): string {
  return `/${role}/${tab.name}`;
}

/** Where an account enters: the first tab of its role (Inicio; Cuentas for the superadmin). */
export function homeHref(role: Role): string {
  const [first] = ROLE_MENU[role].tabs;
  return first ? tabHref(role, first) : `/${role}/more`;
}

/** The "Próximamente" page of a screen that a later phase builds. */
export function comingSoonHref(screen: ScreenId): string {
  return `/common/coming-soon?screen=${screen}`;
}

/**
 * Where a "Más" option goes: the screen when it is built, otherwise its "Próximamente" page
 * (never a route that does not exist yet).
 */
export function moreOptionHref(role: Role, option: MoreOption): string {
  const entry: ScreenEntry = screenById(option.screen);
  return entry.done ? screenHref(entry, role) : comingSoonHref(option.screen);
}
