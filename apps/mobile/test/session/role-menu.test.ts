/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import fs from 'node:fs';
import path from 'node:path';
import { can, ROLES, type Role } from '@bella-vista/shared';
import { allowedFor } from '../../src/session/permissions.js';
import { homeHref, moreOptionHref, ROLE_MENU, tabHref } from '../../src/session/role-menu.js';
import { screenById } from '../../src/session/screen-catalog.js';

// Menu by role (2.5 §1, 3.2 §11.1): each role sees only its tabs and "Más" options, the role is
// the route segment as in ROLES, every tab has its file, and the menu agrees with the
// permissions of @bella-vista/shared.

const APP_DIR = path.resolve(__dirname, '../../app/(app)');

const EXPECTED: Record<Role, { tabs: string[]; more: string[] }> = {
  block_leader: {
    tabs: ['Inicio', 'Cobrar', 'Padrón', 'Mi caja', 'Más'],
    more: ['Solicitudes de toma', 'Reporte de mi manzana', 'Perfil'],
  },
  treasurer: {
    tabs: ['Inicio', 'Entregas', 'Caja', 'Cobrar', 'Más'],
    more: ['Fontanero', 'Tarifas', 'Conceptos', 'Saldos iniciales', 'Cortes', 'Reportes', 'Perfil'],
  },
  secretary: {
    tabs: ['Inicio', 'Padrón', 'Tomas', 'Organización', 'Más'],
    more: ['Acuerdos', 'Suspensiones', 'Reportes', 'Perfil'],
  },
  president: {
    tabs: ['Inicio', 'Autorizaciones', 'Cortes', 'Reportes', 'Más'],
    more: ['Cobrar en apoyo', 'Mi caja de apoyo', 'Padrón (consulta)', 'Bitácora', 'Perfil'],
  },
  member: {
    tabs: ['Inicio', 'Cortes', 'Reportes', 'Más'],
    more: ['Padrón (consulta)', 'Perfil'],
  },
  superadmin: { tabs: ['Cuentas', 'Bitácora', 'Más'], more: ['Perfil'] },
};

describe.each(ROLES.map((role) => [role] as const))('menu of %s', (role) => {
  const menu = ROLE_MENU[role];

  it('has exactly the tabs and "Más" options of 2.5 §1', () => {
    expect(menu.tabs.map((tab) => tab.label)).toEqual(EXPECTED[role].tabs);
    expect(menu.more.map((option) => option.label)).toEqual(EXPECTED[role].more);
  });

  it('only lists what the role may do (same matrix as the API)', () => {
    for (const item of [...menu.tabs, ...menu.more]) {
      if (item.action)
        expect({ item: item.label, allowed: can(role, item.action) }).toEqual({
          item: item.label,
          allowed: true,
        });
    }
    expect(allowedFor(role, menu.tabs)).toHaveLength(menu.tabs.length);
  });

  it('has a file for every tab under app/(app)/<role>/ (the ROLES value, no conversion)', () => {
    for (const tab of menu.tabs) {
      const file = path.join(APP_DIR, role, `${tab.name}.tsx`);
      const index = path.join(APP_DIR, role, tab.name, 'index.tsx');
      expect({ tab: tab.name, exists: fs.existsSync(file) || fs.existsSync(index) }).toEqual({
        tab: tab.name,
        exists: true,
      });
      expect(tabHref(role, tab)).toBe(`/${role}/${tab.name}`);
    }
  });

  it('puts the ID of the screen each tab shows on the first line of its file', () => {
    for (const tab of menu.tabs) {
      const file = fs.existsSync(path.join(APP_DIR, role, `${tab.name}.tsx`))
        ? path.join(APP_DIR, role, `${tab.name}.tsx`)
        : path.join(APP_DIR, role, tab.name, 'index.tsx');
      const line = fs.readFileSync(file, 'utf8').split('\n', 1)[0];
      expect(line).toMatch(new RegExp(`^// ${tab.screen} · ${screenById(tab.screen).title}`));
    }
  });

  it('enters at its first tab and ends "Más" with Perfil', () => {
    expect(homeHref(role)).toBe(`/${role}/${menu.tabs[0]?.name}`);
    expect(menu.tabs.at(-1)?.screen).toBe('C-04');
    expect(menu.more.at(-1)?.screen).toBe('C-05');
  });

  it('sends "Más" options to built screens or to their "Próximamente" page', () => {
    for (const option of menu.more) {
      const href = moreOptionHref(role, option);
      if (screenById(option.screen).done) expect(href).not.toContain('coming-soon');
      else expect(href).toBe(`/common/coming-soon?screen=${option.screen}`);
    }
    expect(moreOptionHref(role, { label: 'Perfil', icon: 'profile', screen: 'C-05' })).toBe(
      '/common/profile',
    );
  });
});

describe('homes', () => {
  it('sends each role to its own home', () => {
    expect(Object.fromEntries(ROLES.map((role) => [role, homeHref(role)]))).toEqual({
      superadmin: '/superadmin/accounts',
      president: '/president/home',
      treasurer: '/treasurer/home',
      secretary: '/secretary/home',
      member: '/member/home',
      block_leader: '/block_leader/home',
    });
  });
});
