/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import { ROLES, type Role, type SessionAccount } from '@bella-vista/shared';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { ROLE_MENU } from '../../src/session/role-menu.js';
import { screenById } from '../../src/session/screen-catalog.js';
import { sessionStore } from '../../src/session/session-store.js';
import { largeTextProblems, setFontScale } from '../ui/render.js';

// Navigation by role with the real app/ folder (3.2 §12, M2): each account enters its home and
// sees only its tabs; another role's URL sends it to its own home; a temporary password only
// opens C-02; without a session everything goes to C-01. The session state is set directly:
// restoring it from the API is covered in session.test.ts.

// Without native insets the SafeAreaProvider renders nothing in Jest: the library's own mock
// gives it the metrics of a phone.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

// Online phone (the offline notice has its own tests).
jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  getNetworkStateAsync: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));

// The root layout waits for Inter; in Jest the fonts are ready at once.
jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: () => [true, null],
}));

jest.mock('../../src/api/useAuth.js', () => ({
  ...jest.requireActual('../../src/api/useAuth.js'),
  // The root layout restores on opening; here each test sets the session itself.
  restoreSession: () => Promise.resolve(),
}));

// Navigation never reaches the network: without an API URL the screens that read data (R-01,
// S-01 since M4) show their own error state. The screens themselves are tested with a scripted
// API in their own files.
jest.mock('../../src/config.js', () => ({ apiBaseUrl: () => null }));

// Built tabs that read the API (A-01 since M3) get an empty answer.
jest.mock('../../src/api/useAccounts.js', () => ({
  ...jest.requireActual('../../src/api/useAccounts.js'),
  useAccountList: () => ({
    status: 'success',
    fetchStatus: 'idle',
    error: null,
    data: { accounts: [], assignmentsWithoutAccount: [] },
    refetch: () => Promise.resolve(),
  }),
}));

const APP = path.resolve(__dirname, '../../app');

function account(role: Role, extra: Partial<SessionAccount> = {}): SessionAccount {
  return {
    username: `usuario.${role}`,
    role,
    blockId: role === 'block_leader' ? 1 : null,
    blockCode: role === 'block_leader' ? 'S1-M01' : null,
    fullName: 'Laura Méndez Ruiz',
    mustChangePassword: false,
    ...extra,
  };
}

async function open(url: string) {
  return renderRouter(APP, { initialUrl: url });
}

const tabLabels = () =>
  screen.getAllByRole('tab').map((tab) => String(tab.props.accessibilityLabel));

beforeEach(() => setFontScale(1));

describe.each(ROLES.map((role) => [role] as const))('%s account', (role) => {
  beforeEach(() => sessionStore.signedIn(account(role)));

  it('enters its home and sees only its tabs', async () => {
    const router = await open('/');
    const home = ROLE_MENU[role].tabs[0]?.name;
    expect(router.getPathname()).toBe(`/${role}/${home}`);
    expect(tabLabels()).toEqual(ROLE_MENU[role].tabs.map((tab) => tab.label));
    // Tabs of later phases say "Próximamente", never a blank screen or an error.
    const entry = screenById(ROLE_MENU[role].tabs[0]?.screen ?? 'C-04');
    // A built home greets the person ("Hola, Laura") instead of repeating its catalog title.
    if (entry.done) expect(screen.queryByText('Próximamente')).toBeNull();
    else expect(screen.getByText('Próximamente')).toBeTruthy();
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
  });

  it('opens "Más" with its options', async () => {
    await open(`/${role}/more`);
    for (const option of ROLE_MENU[role].more) {
      expect(screen.getByRole('button', { name: option.label })).toBeTruthy();
    }
  });
});

describe('guards', () => {
  it("a block leader who types the treasurer's URL lands on its own home", async () => {
    sessionStore.signedIn(account('block_leader'));
    const router = await open('/treasurer/home');
    expect(router.getPathname()).toBe('/block_leader/home');
  });

  it('without a session every URL goes to C-01, which offers no sign-up', async () => {
    sessionStore.signedOut(null);
    const router = await open('/president/approvals');
    expect(router.getPathname()).toBe('/sign-in');
    expect(screen.getByText('Iniciar sesión')).toBeTruthy();
    expect(screen.queryByText(/crear cuenta|registr/i)).toBeNull();
  });

  it('after the app closes the session C-01 says why', async () => {
    sessionStore.signedOut('expired');
    await open('/');
    expect(screen.getByText('Su sesión terminó, inicie sesión de nuevo.')).toBeTruthy();
  });

  it('a temporary password only opens C-02, without a way back', async () => {
    sessionStore.signedIn(account('treasurer', { mustChangePassword: true }));
    const router = await open('/treasurer/home');
    expect(router.getPathname()).toBe('/new-password');
    expect(screen.getByText('Nueva contraseña')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Atrás' })).toBeNull();
    expect(
      screen.getByText('No podrá usar la aplicación hasta cambiar la contraseña temporal.'),
    ).toBeTruthy();
  });

  it('once the password changes the account enters its home', async () => {
    sessionStore.signedIn(account('member', { mustChangePassword: true }));
    const forced = await open('/');
    expect(forced.getPathname()).toBe('/new-password');
    // C-02 saves (the API returns the account without the flag) and goes to the start.
    sessionStore.signedIn(account('member'));
    const after = await open('/');
    expect(after.getPathname()).toBe('/member/home');
  });

  it('leaving the session from inside the app returns to C-01', async () => {
    sessionStore.signedIn(account('secretary'));
    const router = await open('/secretary/home');
    await act(async () => {
      sessionStore.signedOut(null);
    });
    expect(router.getPathname()).toBe('/sign-in');
  });
});

describe('C-05 Perfil', () => {
  it('shows name, user and role with the block, from "Más"', async () => {
    sessionStore.signedIn(account('block_leader'));
    const router = await open('/block_leader/more');
    await fireEvent.press(screen.getByRole('button', { name: 'Perfil' }));
    expect(router.getPathname()).toBe('/common/profile');
    expect(screen.getByText('Laura Méndez Ruiz')).toBeTruthy();
    expect(screen.getByLabelText('Usuario: usuario.block_leader')).toBeTruthy();
    expect(screen.getByLabelText('Cargo: Jefe de manzana · S1-M01')).toBeTruthy();
  });

  it('opens C-02 to change the password, with a way back', async () => {
    sessionStore.signedIn(account('president'));
    const router = await open('/common/profile');
    await fireEvent.press(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(router.getPathname()).toBe('/new-password');
    expect(screen.getByText('Cambiar contraseña')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeTruthy();
  });

  it('asks before closing the session', async () => {
    sessionStore.signedIn(account('member'));
    await open('/common/profile');
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(screen.getByText('¿Cerrar sesión?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sí, cerrar sesión' })).toBeTruthy();
  });

  it('a "Más" option opens its screen (since M8 every screen is built)', async () => {
    sessionStore.signedIn(account('block_leader'));
    const router = await open('/block_leader/more');
    await fireEvent.press(screen.getByRole('button', { name: 'Reporte de mi manzana' }));
    expect(router.getPathname()).toBe('/common/reports/block');
    expect(screen.queryByText('Próximamente')).toBeNull();
  });
});

describe('text at 140 %', () => {
  it.each([
    ['C-01', '/sign-in', () => sessionStore.signedOut('expired')],
    [
      'C-02',
      '/new-password',
      () => sessionStore.signedIn(account('treasurer', { mustChangePassword: true })),
    ],
    ['C-04', '/block_leader/more', () => sessionStore.signedIn(account('block_leader'))],
    ['C-05', '/common/profile', () => sessionStore.signedIn(account('block_leader'))],
  ] as const)('%s is never cut and keeps touch areas of 48', async (_id, url, arrange) => {
    setFontScale(1.4);
    arrange();
    await open(url);
    expect(largeTextProblems(screen.toJSON() as never)).toEqual([]);
  });
});
