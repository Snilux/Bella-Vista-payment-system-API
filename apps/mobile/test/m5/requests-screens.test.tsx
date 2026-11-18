/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import { addMonths, formatPeriod, type SessionAccount } from '@bella-vista/shared';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { businessToday } from '../../src/features/forms/business-date.js';
import {
  NEEDS_AGREEMENT,
  NEEDS_REJECTION_REASON,
} from '../../src/features/registry/agreement-view.js';
import {
  CHARGE_COMES_LATER,
  currentPeriod,
  SUSPENSION_EFFECT,
} from '../../src/features/registry/registry-view.js';
import { sessionStore } from '../../src/session/session-store.js';
import { largeTextProblems, setFontScale } from '../ui/render.js';
import { fakeM5Api } from './fake-m5-api.js';

// M5 · Tomas, acuerdos y suspensiones with the real app/ folder and a scripted API (3.2 §10.4,
// §10.5, §10.7, §12): S-02 has a chip per status with "Por resolver" first; in S-03 the
// agreement decides and a rejection needs a reason; P-06 shows OPENING_NOT_PAID with "Ir a
// cobrar" disabled; J-06 cancels with a reason; S-05 registers an agreement; S-08 lists the
// suspensions, reactivates from this month or the next one and suspends with an agreement.

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
const LEADER: SessionAccount = {
  username: 'jm.s1m01',
  role: 'block_leader',
  blockId: 1,
  blockCode: 'S1-M01',
  fullName: 'Laura Méndez Ruiz',
  mustChangePassword: false,
};

let server: ReturnType<typeof fakeM5Api>;

beforeEach(() => {
  const { createApiClient } = jest.requireActual('../../src/api/client.js');
  const { scriptedFetch, memoryTokens } = jest.requireActual('../api/fake-api.js');
  server = fakeM5Api();
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
const statusesAsked = () =>
  server.gets('/connection-requests').map((call) => new URL(call.url).searchParams.get('status'));

/** Opens a Select by its label and chooses the option whose text matches. */
async function choose(label: RegExp, option: RegExp) {
  await fireEvent.press(screen.getByLabelText(label));
  await fireEvent.press(await screen.findByRole('radio', { name: option }));
}

describe('S-02 · Solicitudes de toma', () => {
  it('opens on "Por resolver" and asks the API one status per chip', async () => {
    await open('/secretary/connection-requests');
    expect(await screen.findByText('ST-000013 · Ernesto Vázquez Soto')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Filtro: Por resolver' }).props.accessibilityState,
    ).toMatchObject({
      selected: true,
    });
    expect(screen.getByText('Por revisar en junta')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Filtro: Por instalar' }));
    expect(await screen.findByText('Aprobada · apertura pagada')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Filtro: Rechazadas' }));
    expect(await screen.findByText('No hay solicitudes en «Rechazadas».')).toBeTruthy();
    expect(statusesAsked()).toEqual(['requested', 'pending_installation', 'rejected']);
  });

  it('a request to resolve opens S-03', async () => {
    const router = await open('/secretary/connection-requests');
    await fireEvent.press(await screen.findByText('ST-000013 · Ernesto Vázquez Soto'));
    expect(router.getPathname()).toBe('/secretary/connection-requests/3/resolve');
  });
});

describe('S-03 · Resolver solicitud', () => {
  it('an approved agreement registers the approval and charges the opening in force', async () => {
    await open('/secretary/connection-requests/3/resolve');
    expect(await screen.findByText('Calle Encino 8')).toBeTruthy();
    expect(screen.getByText(NEEDS_AGREEMENT)).toBeTruthy();
    await choose(/^Acuerdo de junta/, /^AC-000047 · Aprobado por mayoría/);
    expect(
      screen.getByText(
        'Al aprobar se genera el cargo de apertura con el importe vigente: $1,500.00.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar aprobación' }));
    expect(await screen.findByText('Aprobación registrada')).toBeTruthy();
    expect(server.posts('/connection-requests/3/resolve')[0]?.body).toEqual({
      agreementId: 47,
      resolutionReason: null,
    });
  });

  it('a rejected agreement registers the rejection only with a reason', async () => {
    await open('/secretary/connection-requests/3/resolve');
    await screen.findByText('Calle Encino 8');
    await choose(/^Acuerdo de junta/, /^AC-000044 · Rechazado/);
    const button = screen.getByRole('button', { name: 'Registrar rechazo' });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText(NEEDS_REJECTION_REASON)).toBeTruthy();
    await fireEvent.press(button);
    expect(server.posts('/connection-requests/3/resolve')).toHaveLength(0);

    await fireEvent.changeText(
      screen.getByLabelText('Motivo del rechazo, obligatorio'),
      'No hay presión suficiente en esa calle.',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar rechazo' }));
    expect(await screen.findByText('Rechazo registrado')).toBeTruthy();
    expect(server.posts('/connection-requests/3/resolve')[0]?.body).toEqual({
      agreementId: 44,
      resolutionReason: 'No hay presión suficiente en esa calle.',
    });
  });
});

describe('P-05 · Nueva solicitud de toma', () => {
  it('a leader requests in their block and sees the opening fee in force', async () => {
    sessionStore.signedIn(LEADER);
    await open('/common/registry/new-connection-request');
    expect(await screen.findByText(/se cobrará la apertura vigente: \$1,500\.00/)).toBeTruthy();
    expect(screen.getByText('S1-M01')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Buscar por nombre o folio'), 'José');
    await fireEvent.press(
      await screen.findByText(
        'José Luis Hernández García · Papá, Av. Hidalgo',
        {},
        { timeout: 2000 },
      ),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Dirección solicitada, obligatorio'),
      'Av. Hidalgo 14',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar solicitud' }));
    expect(await screen.findByText('Solicitud registrada')).toBeTruthy();
    expect(server.posts('/connection-requests')[0]?.body).toEqual({
      applicantId: 4,
      address: 'Av. Hidalgo 14',
      blockId: 1,
      requestedOn: businessToday(),
    });
  });
});

describe('P-06 · Activar toma', () => {
  it('with the opening unpaid shows the API message and "Ir a cobrar" disabled', async () => {
    sessionStore.signedIn(LEADER);
    await open('/common/connection-requests/5/activate');
    expect(await screen.findByText('$1,500.00 · por pagar')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Activar toma' }));
    expect(await screen.findByText('Primero hay que cobrar la cuota de apertura.')).toBeTruthy();
    const charge = screen.getByRole('button', { name: 'Ir a cobrar' });
    expect(charge.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getAllByText(CHARGE_COMES_LATER).length).toBeGreaterThan(0);
  });

  it('with the opening paid creates the connection and opens it', async () => {
    sessionStore.signedIn(LEADER);
    const router = await open('/common/connection-requests/4/activate');
    expect(await screen.findByText('$1,500.00 · pagada')).toBeTruthy();
    expect(screen.getByText(/como titular\. Pagará completo /)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Activar toma' }));
    await waitFor(() => expect(router.getPathname()).toBe('/common/connections/50'));
    expect(server.posts('/connection-requests/4/activate')[0]?.body).toEqual({
      activatedOn: businessToday(),
      address: null,
      reference: null,
    });
  });
});

describe('J-06 · Mis solicitudes de toma', () => {
  it('lists the requests of the block and cancels a pending one with a reason', async () => {
    sessionStore.signedIn(LEADER);
    const router = await open('/block_leader/more/connection-requests');
    expect(await screen.findByText('Manzana S1-M01')).toBeTruthy();
    // Every status, no chips.
    expect(screen.queryByRole('button', { name: 'Filtro: Por resolver' })).toBeNull();
    expect(statusesAsked()).toEqual([null]);
    await fireEvent.press(await screen.findByText('ST-000013 · Ernesto Vázquez Soto'));
    expect(router.getPathname()).toBe('/common/connection-requests/3/activate');

    await fireEvent.press(await screen.findByRole('button', { name: 'Cancelar solicitud' }));
    const confirm = screen.getAllByRole('button', { name: 'Cancelar solicitud' })[0];
    expect(confirm?.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Escriba el motivo para poder cancelarla.')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Motivo, obligatorio'),
      'El solicitante desistió',
    );
    const enabled = screen.getAllByRole('button', { name: 'Cancelar solicitud' })[0];
    if (enabled) await fireEvent.press(enabled);
    expect(await screen.findByText('Cancelada: El solicitante desistió')).toBeTruthy();
    expect(server.posts('/connection-requests/3/cancel')[0]?.body).toEqual({
      reason: 'El solicitante desistió',
    });
  });
});

describe('S-04 and S-05 · Acuerdos', () => {
  it('lists the agreements and registers one with its votes and minutes as text', async () => {
    const router = await open('/secretary/more/agreements');
    expect(await screen.findByText('AC-000047 · Aprobado por mayoría')).toBeTruthy();
    expect(screen.getByText('AC-000044 · Rechazado')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar acuerdo' }));
    expect(router.getPathname()).toBe('/secretary/more/agreements/new');

    await fireEvent.changeText(
      await screen.findByLabelText('Tema, obligatorio'),
      'Solicitud ST-000013',
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Aprobado por mayoría' }));
    await fireEvent.changeText(screen.getByLabelText('A favor'), '7');
    await fireEvent.changeText(screen.getByLabelText('En contra'), 'dos');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar acuerdo' }));
    expect(screen.getByText('Escriba un número entero.')).toBeTruthy();
    expect(server.posts('/agreements')).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText('En contra'), '2');
    await fireEvent.changeText(
      screen.getByLabelText('Referencia del acta'),
      'Acta 2026-19, foja 3',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar acuerdo' }));
    await waitFor(() => expect(router.getPathname()).toBe('/secretary/more/agreements'));
    expect(server.posts('/agreements')[0]?.body).toEqual({
      meetingDate: businessToday(),
      topic: 'Solicitud ST-000013',
      result: 'approved_by_majority',
      votesFor: 7,
      votesAgainst: 2,
      abstentions: null,
      minutesReference: 'Acta 2026-19, foja 3',
      correctsId: null,
    });
  });
});

describe('S-08 · Suspensiones', () => {
  it('lists what is suspended and says that no fees are generated', async () => {
    await open('/secretary/more/suspensions');
    expect(await screen.findByText('Toma T-000002 · Calle Juárez 8')).toBeTruthy();
    expect(screen.getByText('Fuga sin reparar · 2 familias')).toBeTruthy();
    expect(screen.getByText('Familia U-000077 · Luis Mora')).toBeTruthy();
    expect(screen.getByText('Desde septiembre 2026 · AC-000043')).toBeTruthy();
    expect(screen.getByText(SUSPENSION_EFFECT)).toBeTruthy();
  });

  it('reactivates from this month: the last month without billing is the previous one', async () => {
    await open('/secretary/more/suspensions');
    await fireEvent.press(await screen.findByText('Toma T-000002 · Calle Juárez 8'));
    const now = currentPeriod();
    expect(
      await screen.findByLabelText(`Se vuelve a cobrar desde: ${formatPeriod(now)}`),
    ).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Reactivar' }).at(-1) as never);
    expect(
      await screen.findByText(
        `Toma T-000002 · Calle Juárez 8: se vuelve a cobrar desde ${formatPeriod(now).toLowerCase()}.`,
      ),
    ).toBeTruthy();
    expect(server.posts('/suspensions/1/end')[0]?.body).toEqual({ periodTo: addMonths(now, -1) });
  });

  it('suspends a connection with the first month, a reason and an approved agreement', async () => {
    const router = await open('/secretary/more/suspensions');
    await fireEvent.press(await screen.findByRole('button', { name: 'Suspender toma o familia' }));
    expect(router.getPathname()).toBe('/secretary/more/suspensions/new');
    await fireEvent.changeText(screen.getByLabelText('Buscar calle, folio o titular'), 'Hidalgo');
    await fireEvent.press(
      await screen.findByText('Toma T-000001 · Av. Hidalgo 12', {}, { timeout: 2000 }),
    );
    expect(screen.getByText('Se suspenden sus 2 familias.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Motivo, obligatorio'), 'Fuga sin reparar');
    // Only approved agreements are offered.
    await fireEvent.press(screen.getByLabelText(/^Acuerdo de junta/));
    expect(screen.queryByRole('radio', { name: /^AC-000044/ })).toBeNull();
    await fireEvent.press(await screen.findByRole('radio', { name: /^AC-000047/ }));
    expect(screen.getAllByText(SUSPENSION_EFFECT).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Suspender' }));
    await waitFor(() => expect(router.getPathname()).toBe('/secretary/more/suspensions'));
    expect(server.posts('/suspensions')[0]?.body).toEqual({
      connectionId: 1,
      periodFrom: currentPeriod(),
      reason: 'Fuga sin reparar',
      agreementId: 47,
    });
  });
});

describe('text at 140 %', () => {
  it.each([
    ['S-02', '/secretary/connection-requests', 'ST-000013 · Ernesto Vázquez Soto'],
    ['S-03', '/secretary/connection-requests/3/resolve', 'Calle Encino 8'],
    ['S-04', '/secretary/more/agreements', 'AC-000047 · Aprobado por mayoría'],
    ['S-05', '/secretary/more/agreements/new', 'Registrar acuerdo'],
    ['S-08', '/secretary/more/suspensions', 'Toma T-000002 · Calle Juárez 8'],
    ['P-06', '/common/connection-requests/4/activate', '$1,500.00 · pagada'],
  ])('%s is never cut', async (_id, url, text) => {
    setFontScale(1.4);
    await open(url);
    await screen.findAllByText(text);
    expect(largeTextProblems(screen.toJSON() as never)).toEqual([]);
  });
});
