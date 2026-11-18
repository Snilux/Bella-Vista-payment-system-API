/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import type { SessionAccount } from '@bella-vista/shared';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { SUBSTITUTION_MESSAGES } from '../../src/api/error-messages.js';
import { businessToday } from '../../src/features/forms/business-date.js';
import { sessionStore } from '../../src/session/session-store.js';
import { apiError } from '../api/fake-api.js';
import { largeTextProblems, setFontScale } from '../ui/render.js';
import { closing, fakeM4Api } from './fake-m4-api.js';

// M4 · Organización with the real app/ folder and a scripted API (3.2 §10.7, §12): S-01 counts
// what the API gives; S-06 joins sections, blocks and pending leaders (there is no
// /v1/organization); S-07 lists the current assignments, assigns (committee or leader) and
// substitutes a leader only with the counted extraordinary closing of the block's cashbox.

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
const mockState: { client: ApiClient | null } = { client: null };
jest.mock('../../src/api/api.js', () => ({
  getApiClient: () => mockState.client,
  requireApiClient: () => mockState.client,
}));

const APP = path.resolve(__dirname, '../../app');

const SECRETARY: SessionAccount = {
  username: 'secretario',
  role: 'secretary',
  blockId: null,
  blockCode: null,
  fullName: 'Silvia Montes',
  mustChangePassword: false,
};

let server: ReturnType<typeof fakeM4Api>;

beforeEach(() => {
  const { createApiClient } = jest.requireActual('../../src/api/client.js');
  const { scriptedFetch, memoryTokens } = jest.requireActual('../api/fake-api.js');
  server = fakeM4Api();
  mockState.client = createApiClient({
    baseUrl: 'http://api.test:3000',
    tokens: memoryTokens({ access: 'access-0', refresh: 'refresh-0' }).store,
    onSessionEnded: () => undefined,
    fetchFn: scriptedFetch(server.route).fetchFn,
  });
  setFontScale(1);
  sessionStore.signedIn(SECRETARY);
});

const open = (url: string) => renderRouter(APP, { initialUrl: url });

/** Picks a person in the picker: types the name and taps the result. */
async function choosePerson(name: string) {
  await fireEvent.changeText(screen.getByLabelText('Buscar por nombre o folio'), name);
  await fireEvent.press(await screen.findByText(new RegExp(name), {}, { timeout: 2000 }));
}

describe('S-01 · Inicio del secretario', () => {
  it('shows the figures the API has and the pending work', async () => {
    await open('/secretary/home');
    expect(await screen.findByText('Hola, Silvia')).toBeTruthy();
    expect(await screen.findByText('50')).toBeTruthy();
    expect(screen.getByText('Familias activas')).toBeTruthy();
    expect(await screen.findByText('4')).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Asignaciones por confirmar: 1' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Solicitudes por resolver: 0' })).toBeTruthy();
    // GET /v1/suspensions since M5; no endpoint counts connections, so no "Tomas activas".
    expect(await screen.findByRole('button', { name: 'Suspensiones vigentes: 1' })).toBeTruthy();
    expect(screen.queryByText('Tomas activas')).toBeNull();
  });
});

describe('S-06 · Organización', () => {
  it('groups the blocks by section with their leader and the pending ones', async () => {
    await open('/secretary/organization');
    expect(await screen.findByText('S1 · Sección Centro')).toBeTruthy();
    expect(screen.getByText('S2 · Sección Lomas')).toBeTruthy();
    expect(await screen.findByText('Jefe de manzana: Laura Méndez Ruiz')).toBeTruthy();
    expect(screen.getByText('Sin jefe asignado')).toBeTruthy();
    expect(await screen.findByText('Por confirmar: Teresa Navarro Cruz')).toBeTruthy();
    expect(screen.getByText('Pendiente')).toBeTruthy();
    // S2-M01 before S2-M02, whatever order the API used.
    const codes = screen.getAllByText(/^S\d-M\d\d$/).map((node) => node.props.children);
    expect(codes).toEqual(['S1-M01', 'S1-M02', 'S2-M01', 'S2-M02']);
  });

  it('registers a section and shows the duplicate code next to its field', async () => {
    await open('/secretary/organization');
    await fireEvent.press(await screen.findByRole('button', { name: 'Nueva sección' }));
    await fireEvent.changeText(await screen.findByLabelText('Clave, obligatorio'), 's1');
    await fireEvent.changeText(screen.getByLabelText('Nombre, obligatorio'), 'Sección Norte');
    server.override(
      (call) => call.method === 'POST' && call.url.endsWith('/v1/sections'),
      apiError(409, 'DUPLICATE_CODE', 'La clave S1 ya está registrada.', {
        field: 'code',
        value: 'S1',
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar sección' }));
    expect(await screen.findByText('La clave S1 ya está registrada.')).toBeTruthy();
    expect(server.posts('/v1/sections')[0]?.body).toEqual({ code: 'S1', name: 'Sección Norte' });

    await fireEvent.changeText(screen.getByLabelText('Clave, obligatorio'), 'S3');
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar sección' }));
    expect(await screen.findByText('Se registró la sección S3 · Sección Norte.')).toBeTruthy();
    expect(await screen.findByText('S3 · Sección Norte')).toBeTruthy();
  });

  it('opens a block with its leader and the leader actions', async () => {
    const router = await open('/secretary/organization');
    await fireEvent.press(await screen.findByText('S2-M01'));
    expect(await screen.findByText('Manzana S2-M01')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Asignar jefe' }));
    expect(router.getPathname()).toBe('/secretary/organization/role-assignments/new');
    expect(await screen.findByLabelText('Manzana: S2-M01')).toBeTruthy();
  });
});

describe('S-07 · Cargos y jefes', () => {
  it('lists the committee and the block leaders, with the pending ones', async () => {
    await open('/secretary/organization/role-assignments');
    expect(await screen.findByText('Presidente')).toBeTruthy();
    expect(screen.getByText('Roberto Sánchez Gil · desde 2026-01-01')).toBeTruthy();
    expect(screen.getByText('S1-M01 · Laura Méndez Ruiz')).toBeTruthy();
    expect(screen.getByText('5551002001 · desde 2026-01-01')).toBeTruthy();
    expect(screen.getByText('S2-M02 · Teresa Navarro Cruz')).toBeTruthy();
    expect(screen.getByText('Asignación por confirmar')).toBeTruthy();
    expect(screen.getByText('Pendiente')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('assigns a committee role and sends it to the president', async () => {
    server.state.assignments = server.state.assignments.filter((item) => item.role !== 'president');
    await open('/secretary/organization/role-assignments/new?role=president');
    expect(await screen.findByLabelText('Cargo: Presidente')).toBeTruthy();
    expect(screen.queryByLabelText(/^Manzana/)).toBeNull();
    await choosePerson('Ernesto');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar al presidente' }));

    expect(await screen.findByText('Enviada al presidente')).toBeTruthy();
    expect(server.posts('/v1/role-assignments')[0]?.body).toEqual({
      personId: 8,
      role: 'president',
      blockId: null,
      contactPhone: null,
      startDate: businessToday(),
    });
  });

  it('a block leader needs a block and a contact phone', async () => {
    await open('/secretary/organization/role-assignments/new?role=block_leader&blockId=4');
    await choosePerson('Ernesto');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar al presidente' }));
    expect(
      await screen.findByText('El jefe de manzana debe tener un teléfono de contacto.'),
    ).toBeTruthy();
    expect(server.posts('/v1/role-assignments')).toHaveLength(0);

    await fireEvent.changeText(
      screen.getByLabelText('Teléfono de contacto, obligatorio'),
      '5551003000',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar al presidente' }));
    expect(await screen.findByText('Enviada al presidente')).toBeTruthy();
    expect(server.posts('/v1/role-assignments')[0]?.body).toMatchObject({
      role: 'block_leader',
      blockId: 4,
      contactPhone: '5551003000',
    });
  });
});

describe('S-07 · Sustituir jefe', () => {
  const openFor = (blockId: number) =>
    open(`/secretary/organization/role-assignments/substitution?blockId=${blockId}`);

  it('without the extraordinary closing says what is missing and sends nothing', async () => {
    await openFor(1);
    expect(await screen.findByText(SUBSTITUTION_MESSAGES.noClosing)).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Enviar al presidente' });
    expect(send.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Falta el corte extraordinario contado.')).toBeTruthy();
    expect(server.posts('/leader-substitution')).toHaveLength(0);
  });

  it('with the closing not counted yet asks for the count', async () => {
    server.state.closings = [
      closing({ id: 7, status: 'draft', countedCash: null, difference: null }),
    ];
    await openFor(1);
    expect(await screen.findByText(SUBSTITUTION_MESSAGES.notCounted)).toBeTruthy();
  });

  it('ignores the closings of other blocks and the monthly ones', async () => {
    server.state.closings = [
      closing({ id: 7, cashbox: { id: 11, type: 'block', label: 'S1-M02' } }),
      closing({ id: 8, type: 'monthly' }),
    ];
    await openFor(1);
    expect(await screen.findByText(SUBSTITUTION_MESSAGES.noClosing)).toBeTruthy();
  });

  it('substitutes with the counted closing and leaves the new leader pending', async () => {
    server.state.closings = [closing({ id: 7 })];
    await openFor(1);
    expect(await screen.findByText('Corte CC-000007 del 2026-11-17')).toBeTruthy();
    expect(screen.getByText('Laura Méndez Ruiz')).toBeTruthy();

    await choosePerson('Ernesto');
    await fireEvent.changeText(
      screen.getByLabelText('Teléfono de contacto, obligatorio'),
      '5551004000',
    );
    await fireEvent.changeText(screen.getByLabelText('Motivo, obligatorio'), 'Se mudó de colonia.');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar al presidente' }));

    expect(await screen.findByText('Enviada al presidente')).toBeTruthy();
    expect(
      screen.getByText(/Laura Méndez Ruiz dejó el cargo y su cuenta se desactivó/),
    ).toBeTruthy();
    expect(server.posts('/v1/blocks/1/leader-substitution')[0]?.body).toEqual({
      closingId: 7,
      personId: 8,
      contactPhone: '5551004000',
      startDate: businessToday(),
      reason: 'Se mudó de colonia.',
    });
  });

  it('the outgoing leader cannot be the new one', async () => {
    server.state.closings = [closing({ id: 7 })];
    await openFor(1);
    await screen.findByText('Corte CC-000007 del 2026-11-17');
    await fireEvent.changeText(screen.getByLabelText('Buscar por nombre o folio'), 'Laura');
    expect(await screen.findByText('Es el jefe saliente.', {}, { timeout: 2000 })).toBeTruthy();
  });

  it('shows the API refusal in Spanish (closing with later movements)', async () => {
    server.state.closings = [closing({ id: 7 })];
    server.override(
      (call) => call.url.endsWith('/leader-substitution'),
      apiError(409, 'INVALID_STATE', 'La caja tuvo movimientos después del corte.', {
        status: 'stale_closing',
        action: 'substitute_leader',
      }),
    );
    await openFor(1);
    await screen.findByText('Corte CC-000007 del 2026-11-17');
    await choosePerson('Ernesto');
    await fireEvent.changeText(
      screen.getByLabelText('Teléfono de contacto, obligatorio'),
      '5551004000',
    );
    await fireEvent.changeText(screen.getByLabelText('Motivo, obligatorio'), 'Cambio.');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar al presidente' }));
    await waitFor(() => expect(screen.getByText(SUBSTITUTION_MESSAGES.staleClosing)).toBeTruthy());
  });
});

describe('text at 140 %', () => {
  it.each([
    ['S-01', '/secretary/home', 'Familias activas'],
    ['S-06', '/secretary/organization', 'Sin jefe asignado'],
    ['S-07', '/secretary/organization/role-assignments', 'Asignación por confirmar'],
  ])('%s is never cut', async (_id, url, text) => {
    setFontScale(1.4);
    await open(url);
    await screen.findAllByText(text);
    expect(largeTextProblems(screen.toJSON() as never)).toEqual([]);
  });
});
