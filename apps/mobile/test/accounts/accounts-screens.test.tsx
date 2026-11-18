/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import type { AccountListResponse, AccountSummary, SessionAccount } from '@bella-vista/shared';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { sessionStore } from '../../src/session/session-store.js';
import { apiError, type Call, json, type Reply } from '../api/fake-api.js';
import { largeTextProblems, setFontScale } from '../ui/render.js';
import { account, assignment } from './fixtures.js';

// M3 · Superadministrador with the real app/ folder and a scripted API (3.2 §10.8, §12):
// A-01 lists the assignments without account and the accounts with their status; A-02 shows the
// temporary password once, with Copiar, and keeps it in no cache; A-03 offers only the actions
// that fit the account's status, each with its reason; A-04 names each technical action.

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  getNetworkStateAsync: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: () => [true, null],
}));
jest.mock('../../src/api/useAuth.js', () => ({
  ...jest.requireActual('../../src/api/useAuth.js'),
  restoreSession: () => Promise.resolve(),
}));

const mockClipboard = jest.fn((_text: string) => Promise.resolve(true));
jest.mock('expo-clipboard', () => ({
  setStringAsync: (text: string) => mockClipboard(text),
}));
const mockPreventCapture = jest.fn();
jest.mock('expo-screen-capture', () => ({
  usePreventScreenCapture: () => mockPreventCapture(),
}));

// The app's client, answered by the fake server below; and the query client the root layout
// creates, to look into its caches.
const mockState: { client: ApiClient | null; queryClient: QueryClient | null } = {
  client: null,
  queryClient: null,
};
jest.mock('../../src/api/api.js', () => ({ getApiClient: () => mockState.client }));
jest.mock('../../src/api/query-client.js', () => {
  const actual = jest.requireActual('../../src/api/query-client.js');
  return {
    ...actual,
    createQueryClient: () => {
      mockState.queryClient = actual.createQueryClient();
      return mockState.queryClient;
    },
  };
});

const APP = path.resolve(__dirname, '../../app');
const PASSWORD = 'Kp7xQ2mN9vRt';

const ADMIN: SessionAccount = {
  username: 'admin',
  role: 'superadmin',
  blockId: null,
  blockCode: null,
  fullName: 'Administrador del Sistema',
  mustChangePassword: false,
};

/** In-memory accounts API: enough of /v1/accounts and /v1/audit-log for the screens. */
function fakeServer() {
  const list: AccountListResponse = {
    accounts: [
      account({ id: 1, username: 'admin', role: 'superadmin', roleAssignmentId: 1 }),
      account({ id: 5, username: 'tesorero' }),
      account({
        id: 6,
        username: 'presidente',
        role: 'president',
        roleAssignmentId: 6,
        status: 'locked',
        lockedUntil: '9999-12-31T00:00:00.000Z',
      }),
      account({
        id: 7,
        username: 'vocal.anterior',
        role: 'member',
        roleAssignmentId: 7,
        status: 'disabled',
        deactivatedAt: '2026-11-02T18:00:00.000Z',
      }),
    ],
    assignmentsWithoutAccount: [assignment()],
  };
  const calls: Call[] = [];
  const find = (id: number) => list.accounts.find((item) => item.id === id);
  const update = (id: number, change: Partial<AccountSummary>) => {
    const current = find(id);
    if (!current) return null;
    const next = { ...current, ...change };
    list.accounts = list.accounts.map((item) => (item.id === id ? next : item));
    return next;
  };

  const route = (call: Call): Reply => {
    calls.push(call);
    const url = new URL(call.url);
    const pathName = url.pathname.replace(/^\/v1/, '');
    const body = call.body as Record<string, unknown> | undefined;
    if (call.method === 'GET' && pathName === '/accounts') return json(200, list);
    if (call.method === 'POST' && pathName === '/accounts') {
      if (list.accounts.some((item) => item.username === body?.username)) {
        return apiError(409, 'USERNAME_TAKEN', `El usuario "${String(body?.username)}" ya existe.`);
      }
      const created = account({
        id: 20,
        username: String(body?.username),
        role: 'member',
        roleAssignmentId: Number(body?.roleAssignmentId),
        status: 'must_change_password',
        mustChangePassword: true,
        person: assignment().person,
      });
      list.accounts = [...list.accounts, created];
      list.assignmentsWithoutAccount = [];
      return json(201, { account: created, temporaryPassword: PASSWORD });
    }
    const action = /^\/accounts\/(\d+)\/([a-z-]+)$/.exec(pathName);
    if (call.method === 'POST' && action) {
      const id = Number(action[1]);
      const changes: Record<string, Partial<AccountSummary>> = {
        'reset-password': { status: 'must_change_password', mustChangePassword: true },
        lock: { status: 'locked', lockedUntil: '9999-12-31T00:00:00.000Z' },
        unlock: { status: 'active', lockedUntil: null, failedAttempts: 0 },
        deactivate: { status: 'disabled', deactivatedAt: '2026-11-17T18:00:00.000Z' },
      };
      const next = update(id, changes[action[2] ?? ''] ?? {});
      if (!next) return apiError(404, 'NOT_FOUND', 'No existe esa cuenta.');
      return action[2] === 'reset-password'
        ? json(200, { account: next, temporaryPassword: PASSWORD })
        : json(200, { account: next });
    }
    if (call.method === 'GET' && pathName === '/audit-log') {
      return json(200, {
        data: [
          {
            id: 2,
            userAccountId: 1,
            username: 'admin',
            role: 'superadmin',
            action: 'reset_password',
            tableName: 'user_account',
            recordId: 5,
            before: null,
            after: null,
            reason: 'Olvidó su contraseña',
            isTechnical: true,
            fullName: 'Rolando Gómez Torres',
            createdAt: '2026-10-23T16:00:00.000Z',
          },
          {
            id: 1,
            userAccountId: 1,
            username: 'admin',
            role: 'superadmin',
            action: 'create',
            tableName: 'user_account',
            recordId: 6,
            before: null,
            after: null,
            reason: null,
            isTechnical: true,
            fullName: 'Rolando Gómez Torres',
            createdAt: '2026-10-20T16:00:00.000Z',
          },
        ],
        next: null,
      });
    }
    return apiError(404, 'NOT_FOUND', 'No existe.');
  };
  return { route, calls, list };
}

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  const { createApiClient } = jest.requireActual('../../src/api/client.js');
  const { scriptedFetch, memoryTokens } = jest.requireActual('../api/fake-api.js');
  server = fakeServer();
  const { fetchFn } = scriptedFetch(server.route);
  mockState.client = createApiClient({
    baseUrl: 'http://api.test:3000',
    tokens: memoryTokens({ access: 'access-0', refresh: 'refresh-0' }).store,
    onSessionEnded: () => undefined,
    fetchFn,
  });
  mockClipboard.mockClear();
  mockPreventCapture.mockClear();
  setFontScale(1);
  sessionStore.signedIn(ADMIN);
});

const open = (url: string) => renderRouter(APP, { initialUrl: url });

/** Everything TanStack Query keeps, as text. */
function cachedText(): string {
  const client = mockState.queryClient;
  if (!client) return '';
  return JSON.stringify([
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
    client
      .getMutationCache()
      .getAll()
      .map((mutation) => [mutation.state.data, mutation.state.variables]),
  ]);
}

const postsTo = (suffix: string) =>
  server.calls.filter((call) => call.method === 'POST' && call.url.endsWith(suffix));

describe('A-01 · Cuentas', () => {
  it('lists the assignments without account first and each account with its status', async () => {
    await open('/superadmin/accounts');
    expect(await screen.findByText('Silvia Ramírez Cruz · sin cuenta')).toBeTruthy();
    expect(screen.getByText('Sin cuenta')).toBeTruthy();
    expect(screen.getByText('Vocal · desde 1 ene 2026')).toBeTruthy();
    expect(screen.getByText('Bloqueada por el administrador')).toBeTruthy();
    expect(screen.getByText('Desactivada el 2 nov 2026, 12:00')).toBeTruthy();
    expect(screen.getAllByText('Activa')).toHaveLength(2);
  });

  it('searches by user or name on the phone', async () => {
    await open('/superadmin/accounts');
    await screen.findByText('tesorero');
    await fireEvent.changeText(screen.getByLabelText('Buscar usuario'), 'PRESI');
    expect(screen.getByText('presidente')).toBeTruthy();
    expect(screen.queryByText('tesorero')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Buscar usuario'), 'nadie');
    expect(screen.getByText('Ningún usuario coincide con «nadie».')).toBeTruthy();
  });
});

describe('A-02 · Crear cuenta', () => {
  async function createFromInbox() {
    const router = await open('/superadmin/accounts');
    await fireEvent.press(await screen.findByText('Silvia Ramírez Cruz · sin cuenta'));
    expect(router.getPathname()).toBe('/superadmin/accounts/new');
    return router;
  }

  it('opens with the assignment chosen, a proposed user and no tab bar', async () => {
    await createFromInbox();
    expect(
      await screen.findByLabelText('Asignación vigente sin cuenta: Silvia Ramírez Cruz · Vocal'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Usuario, obligatorio').props.value).toBe('silvia.ramirez');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('shows the temporary password once, copies it, keeps it in no cache and asks before leaving', async () => {
    const router = await createFromInbox();
    await screen.findByLabelText('Usuario, obligatorio');
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByText(PASSWORD)).toBeTruthy();
    expect(postsTo('/v1/accounts')[0]?.body).toEqual({
      roleAssignmentId: 12,
      username: 'silvia.ramirez',
    });
    expect(screen.getByText(/Se muestra una sola vez/)).toBeTruthy();
    expect(mockPreventCapture).toHaveBeenCalled();
    // Only this screen holds it: neither the query cache nor the mutation cache.
    await waitFor(() => expect(cachedText()).not.toContain(PASSWORD));
    expect(cachedText()).toContain('silvia.ramirez');

    await fireEvent.press(screen.getByRole('button', { name: 'Copiar' }));
    expect(mockClipboard).toHaveBeenCalledWith(PASSWORD);

    // Atrás asks first; "Volver" keeps the password on screen.
    await fireEvent.press(screen.getByRole('button', { name: 'Atrás' }));
    expect(screen.getByText('¿Ya anotó la contraseña?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByText(PASSWORD)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Listo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Sí, salir' }));
    await waitFor(() => expect(router.getPathname()).toBe('/superadmin/accounts'));
    expect(screen.queryByText(PASSWORD)).toBeNull();
    // A copied password does not stay on the phone.
    expect(mockClipboard).toHaveBeenLastCalledWith('');
    expect(await screen.findByText('silvia.ramirez')).toBeTruthy();
    expect(screen.queryByText('Silvia Ramírez Cruz · sin cuenta')).toBeNull();
  });

  it('says next to the field when the user name already exists', async () => {
    await createFromInbox();
    await fireEvent.changeText(await screen.findByLabelText('Usuario, obligatorio'), 'tesorero');
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Ese nombre de usuario ya existe. Escriba otro.')).toBeTruthy();
    expect(screen.queryByText(PASSWORD)).toBeNull();
  });

  it('asks for the assignment when the one in the link no longer waits for an account', async () => {
    await open('/superadmin/accounts/new?roleAssignmentId=999');
    await fireEvent.changeText(await screen.findByLabelText('Usuario, obligatorio'), 'alguien');
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByText('Elija la asignación de cargo.')).toBeTruthy();
    expect(postsTo('/v1/accounts')).toHaveLength(0);
  });

  it('checks the user name before sending', async () => {
    await createFromInbox();
    await fireEvent.changeText(await screen.findByLabelText('Usuario, obligatorio'), 'a b');
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByText(/El usuario debe tener de 3 a 32 caracteres/)).toBeTruthy();
    expect(postsTo('/v1/accounts')).toHaveLength(0);
  });
});

describe('A-03 · Detalle de cuenta', () => {
  const buttons = () =>
    ['Restablecer contraseña', 'Bloquear cuenta', 'Desbloquear cuenta', 'Desactivar cuenta'].filter(
      (name) => screen.queryByRole('button', { name }) !== null,
    );

  it.each([
    ['an active account', 5, ['Restablecer contraseña', 'Bloquear cuenta', 'Desactivar cuenta']],
    ['an account locked by the superadmin', 6, ['Desbloquear cuenta', 'Desactivar cuenta']],
    ['a disabled account', 7, []],
    ["the superadmin's own account", 1, []],
  ])('offers only what fits %s', async (_name, id, expected) => {
    await open(`/superadmin/accounts/${id}`);
    await screen.findByText('Intentos fallidos');
    expect(buttons()).toEqual(expected);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('locks with a reason, then offers "Desbloquear" instead of "Bloquear"', async () => {
    await open('/superadmin/accounts/5');
    await fireEvent.press(await screen.findByRole('button', { name: 'Bloquear cuenta' }));
    expect(screen.getByText('¿Bloquear la cuenta?')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Sí, bloquear' }));
    expect(screen.getByText('Escriba el motivo.')).toBeTruthy();
    expect(postsTo('/lock')).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText('Motivo, obligatorio'), 'Uso indebido');
    await fireEvent.press(screen.getByRole('button', { name: 'Sí, bloquear' }));
    expect(
      await screen.findByText('La cuenta quedó bloqueada y sus sesiones se cerraron.'),
    ).toBeTruthy();
    expect(postsTo('/v1/accounts/5/lock')[0]?.body).toEqual({ reason: 'Uso indebido' });
    expect(buttons()).toEqual(['Desbloquear cuenta', 'Desactivar cuenta']);
  });

  it('resets with a reason and shows the new password once, in no cache', async () => {
    await open('/superadmin/accounts/5');
    await fireEvent.press(await screen.findByRole('button', { name: 'Restablecer contraseña' }));
    await fireEvent.changeText(
      screen.getByLabelText('Motivo, obligatorio'),
      'Olvidó su contraseña',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Sí, restablecer' }));

    expect(await screen.findByText(PASSWORD)).toBeTruthy();
    expect(postsTo('/v1/accounts/5/reset-password')[0]?.body).toEqual({
      reason: 'Olvidó su contraseña',
    });
    expect(mockPreventCapture).toHaveBeenCalled();
    await waitFor(() => expect(cachedText()).not.toContain(PASSWORD));
    expect(screen.getByLabelText('Estado: Contraseña temporal')).toBeTruthy();
    // While the password is on screen the only action is "Listo".
    expect(buttons()).toEqual([]);
  });
});

describe('A-04 · Bitácora técnica', () => {
  it('names each technical action and the account it touched', async () => {
    await open('/superadmin/audit-log');
    expect(await screen.findByText('Contraseña restablecida')).toBeTruthy();
    expect(
      await screen.findByText('tesorero · 23 oct 2026, 10:00 · Olvidó su contraseña · por admin'),
    ).toBeTruthy();
    expect(screen.getByText('Cuenta creada')).toBeTruthy();
    expect(
      screen.getByText('El soporte técnico no puede registrar cobros, gastos ni autorizaciones.'),
    ).toBeTruthy();
  });
});

describe('text at 140 %', () => {
  it.each([
    ['A-01', '/superadmin/accounts', 'tesorero'],
    ['A-02', '/superadmin/accounts/new?roleAssignmentId=12', 'Crear cuenta'],
    ['A-03', '/superadmin/accounts/6', 'Intentos fallidos'],
    ['A-04', '/superadmin/audit-log', 'Cuenta creada'],
  ])('%s is never cut', async (_id, url, text) => {
    setFontScale(1.4);
    await open(url);
    await screen.findAllByText(text);
    expect(largeTextProblems(screen.toJSON() as never)).toEqual([]);
  });
});
