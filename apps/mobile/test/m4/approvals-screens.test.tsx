/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import type { SessionAccount } from '@bella-vista/shared';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { REJECT_NEEDS_REASON } from '../../src/features/approvals/RejectSheet.js';
import { sessionStore } from '../../src/session/session-store.js';
import { apiError } from '../api/fake-api.js';
import { largeTextProblems, setFontScale } from '../ui/render.js';
import { fakeM4Api } from './fake-m4-api.js';

// M4 · Autorizaciones with the real app/ folder and a scripted API (3.2 §10.8, §12): R-01 shows
// the community figures of the API; R-02 groups the inbox by type and the tab counts it; R-03
// shows who asks, why and what is authorized; rejecting needs a reason (the button says why
// it is disabled) and resolving updates the inbox and the counter at once.

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

const PRESIDENT: SessionAccount = {
  username: 'presidente',
  role: 'president',
  blockId: null,
  blockCode: null,
  fullName: 'Roberto Sánchez Gil',
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
  sessionStore.signedIn(PRESIDENT);
});

const open = (url: string) => renderRouter(APP, { initialUrl: url });
/** The sheet lives in the screen content, before the fixed bar: its "Rechazar" comes first. */
const sheetReject = () => screen.getAllByRole('button', { name: 'Rechazar' })[0];
const approvalsTab = () =>
  screen.getAllByRole('tab').find((tab) => /^Autorizaciones/.test(tab.props.accessibilityLabel));

describe('R-01 · Inicio del presidente', () => {
  it('shows the community figures of the API and what waits for the president', async () => {
    await open('/president/home');
    expect(await screen.findByText('$31,850.00')).toBeTruthy();
    expect(screen.getByText('Hola, Roberto')).toBeTruthy();
    expect(screen.getByText('$12,400.00')).toBeTruthy();
    expect(screen.getByText('$19,450.00')).toBeTruthy();
    expect(screen.getByText('$48,300.00')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Revisar autorizaciones (3)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cortes por revisar: 0' })).toBeTruthy();
  });
});

describe('R-02 · Autorizaciones', () => {
  it('groups the inbox by type and counts it in the tab', async () => {
    await open('/president/approvals');
    expect(await screen.findByText('3 pendientes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Asignación de cargo: 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelación de pago: 2' })).toBeTruthy();
    await waitFor(() =>
      expect(approvalsTab()?.props.accessibilityLabel).toBe('Autorizaciones, 3 pendientes'),
    );
  });

  it('opens the only request of a type, or the list when there are several', async () => {
    const router = await open('/president/approvals');
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancelación de pago: 2' }));
    expect(router.getPathname()).toBe('/president/approvals/list');
    expect(await screen.findByText('Cancelar el pago PG-000981 ($200.00)')).toBeTruthy();
    expect(screen.getByText('Cancelar el pago PG-000990 ($50.00)')).toBeTruthy();
  });
});

describe('R-03 · Detalle de autorización', () => {
  async function openAssignment() {
    const router = await open('/president/approvals');
    await fireEvent.press(await screen.findByRole('button', { name: 'Asignación de cargo: 1' }));
    expect(router.getPathname()).toBe('/president/approvals/31');
    await screen.findByText('Jefe de manzana S2-M02: Teresa Navarro Cruz, desde el 2026-11-18');
    return router;
  }

  it('shows who requests it, the reason and what is authorized, without the tab bar', async () => {
    await openAssignment();
    expect(screen.getByText('Silvia Montes · Secretario')).toBeTruthy();
    expect(screen.getByText('Acuerdo de asamblea del 15 de noviembre')).toBeTruthy();
    expect(screen.getByText('Pendiente')).toBeTruthy();
    expect(screen.getByText(/la manzana se queda sin jefe/)).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('does not reject without a reason and says why the button is disabled', async () => {
    await openAssignment();
    await fireEvent.press(screen.getByRole('button', { name: 'Rechazar' }));
    expect(await screen.findByText('Rechazar solicitud')).toBeTruthy();
    expect(screen.getByText(REJECT_NEEDS_REASON)).toBeTruthy();

    const confirm = sheetReject();
    expect(confirm?.props.accessibilityState).toMatchObject({ disabled: true });
    if (confirm) await fireEvent.press(confirm);
    // Only spaces count as nothing too.
    await fireEvent.changeText(screen.getByLabelText('Motivo del rechazo, obligatorio'), '   ');
    expect(screen.getByText(REJECT_NEEDS_REASON)).toBeTruthy();
    expect(server.posts('/resolve')).toHaveLength(0);
  });

  it('rejects with a reason and the inbox and the counter update at once', async () => {
    const router = await openAssignment();
    await fireEvent.press(screen.getByRole('button', { name: 'Rechazar' }));
    await fireEvent.changeText(
      await screen.findByLabelText('Motivo del rechazo, obligatorio'),
      'La asamblea no lo aprobó.',
    );
    expect(screen.queryByText(REJECT_NEEDS_REASON)).toBeNull();
    const confirm = sheetReject();
    if (confirm) await fireEvent.press(confirm);

    expect(await screen.findByText('Solicitud rechazada.')).toBeTruthy();
    expect(server.posts('/approvals/31/resolve')[0]?.body).toEqual({
      result: 'rejected',
      reason: 'La asamblea no lo aprobó.',
    });
    expect(screen.getByText('Rechazada')).toBeTruthy();
    expect(screen.getByText('La asamblea no lo aprobó.')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Volver a autorizaciones' }));
    expect(router.getPathname()).toBe('/president/approvals');
    expect(await screen.findByText('2 pendientes')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Asignación de cargo: 1' })).toBeNull();
    await waitFor(() =>
      expect(approvalsTab()?.props.accessibilityLabel).toBe('Autorizaciones, 2 pendientes'),
    );
  });

  it('authorizes after confirming, without asking for a reason', async () => {
    await openAssignment();
    await fireEvent.press(screen.getByRole('button', { name: 'Autorizar' }));
    expect(await screen.findByText('¿Autorizar esta solicitud?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Sí, autorizar' }));
    expect(await screen.findByText('Solicitud autorizada.')).toBeTruthy();
    expect(server.posts('/approvals/31/resolve')[0]?.body).toEqual({ result: 'approved' });
    expect(screen.getByText('Autorizada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).toBeNull();
  });

  it('says so when someone else already resolved it', async () => {
    await openAssignment();
    server.override(
      (call) => call.method === 'POST' && call.url.endsWith('/approvals/31/resolve'),
      apiError(409, 'APPROVAL_ALREADY_RESOLVED', 'Esta solicitud ya fue resuelta.'),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Autorizar' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, autorizar' }));
    expect(
      await screen.findByText('Esta solicitud ya fue resuelta. Se actualizó la pantalla.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Volver a autorizaciones' })).toBeTruthy();
  });
});

describe('text at 140 %', () => {
  it.each([
    ['R-01', '/president/home', '$31,850.00'],
    ['R-02', '/president/approvals', '3 pendientes'],
    ['R-03', '/president/approvals/32', 'Cancelar el pago PG-000981 ($200.00)'],
  ])('%s is never cut', async (_id, url, text) => {
    setFontScale(1.4);
    await open(url);
    await screen.findAllByText(text);
    expect(largeTextProblems(screen.toJSON() as never)).toEqual([]);
  });
});
