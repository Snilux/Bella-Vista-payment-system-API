/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import type { SessionAccount } from '@bella-vista/shared';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { UNKNOWN_OUTCOME_MESSAGE } from '../../src/api/error-messages.js';
import { MISSING_HOLDER, MISSING_REASON } from '../../src/features/approvals/approval-types.js';
import { sessionStore } from '../../src/session/session-store.js';
import { apiError } from '../api/fake-api.js';
import { largeTextProblems, setFontScale } from '../ui/render.js';
import { fakeM4Api } from './fake-m4-api.js';

// G-11 · Solicitud con motivo (3.2 §10.2, §11.2): one form for every type; the reason is
// mandatory; the money requests carry an Idempotency-Key that the retry keeps; once sent it says
// "Enviada al presidente" and cannot be sent again.

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
let mockKeys = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `key-${++mockKeys}` }));
const mockState: { client: ApiClient | null } = { client: null };
jest.mock('../../src/api/api.js', () => ({
  getApiClient: () => mockState.client,
  requireApiClient: () => mockState.client,
}));

const APP = path.resolve(__dirname, '../../app');

const account = (role: SessionAccount['role']): SessionAccount => ({
  username: role === 'block_leader' ? 'jm.s1m01' : role,
  role,
  blockId: role === 'block_leader' ? 1 : null,
  blockCode: role === 'block_leader' ? 'S1-M01' : null,
  fullName: 'Laura Méndez Ruiz',
  mustChangePassword: false,
});

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
  mockKeys = 0;
  setFontScale(1);
});

const open = (query: string) =>
  renderRouter(APP, { initialUrl: `/common/approval-request?${query}` });
const send = () => screen.getByRole('button', { name: 'Enviar solicitud' });
const keyOf = (index: number) =>
  server.posts('/request-cancellation')[index]?.headers['Idempotency-Key'];

describe('G-11 · Solicitud con motivo', () => {
  it('asks for the reason before sending, and says why the button is disabled', async () => {
    sessionStore.signedIn(account('block_leader'));
    await open('type=payment_cancellation&id=981&subject=Pago%20PG-000981%20%C2%B7%20%24200.00');
    expect(await screen.findByText('Solicitar cancelación')).toBeTruthy();
    expect(screen.getByText('Pago PG-000981 · $200.00')).toBeTruthy();
    expect(
      screen.getByText('Mientras el presidente no la autorice, el pago sigue vigente.'),
    ).toBeTruthy();
    expect(screen.getByText(MISSING_REASON)).toBeTruthy();
    expect(send().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(send());
    expect(server.posts('/request-cancellation')).toHaveLength(0);
  });

  it('sends a money request with its key and shows "Enviada al presidente"', async () => {
    sessionStore.signedIn(account('block_leader'));
    await open('type=payment_cancellation&id=981');
    await fireEvent.changeText(
      await screen.findByLabelText('Motivo, obligatorio'),
      'Se registró en la familia equivocada.',
    );
    await fireEvent.press(send());
    expect(await screen.findByText('Enviada al presidente')).toBeTruthy();
    const [call] = server.posts('/v1/payments/981/request-cancellation');
    expect(call?.body).toEqual({ reason: 'Se registró en la familia equivocada.' });
    expect(keyOf(0)).toBe('key-1');
    // Nothing left to send again.
    expect(screen.queryByRole('button', { name: 'Enviar solicitud' })).toBeNull();
  });

  it('without an answer says it may have gone in and retries with the same key', async () => {
    sessionStore.signedIn(account('block_leader'));
    server.override((call) => call.url.endsWith('/request-cancellation'), { networkError: true });
    await open('type=payment_cancellation&id=981');
    await fireEvent.changeText(await screen.findByLabelText('Motivo, obligatorio'), 'Duplicado.');
    await fireEvent.press(send());

    expect(await screen.findByText('No sabemos si se registró.')).toBeTruthy();
    expect(screen.getByText(UNKNOWN_OUTCOME_MESSAGE)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Enviada al presidente')).toBeTruthy();
    expect(server.posts('/request-cancellation')).toHaveLength(2);
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('after an answer of the API, a new attempt gets a new key', async () => {
    sessionStore.signedIn(account('block_leader'));
    server.override(
      (call) => call.url.endsWith('/request-cancellation'),
      apiError(409, 'INVALID_STATE', 'Ya hay una solicitud.', { status: 'pending', action: 'x' }),
    );
    await open('type=payment_cancellation&id=981');
    await fireEvent.changeText(await screen.findByLabelText('Motivo, obligatorio'), 'Duplicado.');
    await fireEvent.press(send());
    expect(await screen.findByText('Esto ya cambió. Se actualizó la pantalla.')).toBeTruthy();
    await fireEvent.press(send());
    expect(await screen.findByText('Enviada al presidente')).toBeTruthy();
    expect(keyOf(0)).toBe('key-1');
    expect(keyOf(1)).toBe('key-2');
  });

  it('sends a family request without a key, and the holder change asks for the new holder', async () => {
    sessionStore.signedIn(account('secretary'));
    await open('type=holder_change&id=45&subject=Familia%20U-0045');
    expect(await screen.findByText('Cambiar titular')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Motivo, obligatorio'),
      'Falleció el titular.',
    );
    expect(screen.getByText(MISSING_HOLDER)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Buscar por nombre o folio'), 'Ernesto');
    await fireEvent.press(await screen.findByText('Ernesto Vázquez Soto', {}, { timeout: 2000 }));
    expect(screen.queryByText(MISSING_HOLDER)).toBeNull();
    await fireEvent.press(send());

    expect(await screen.findByText('Enviada al presidente')).toBeTruthy();
    const [call] = server.posts('/v1/units/45/request-holder-change');
    expect(call?.body).toEqual({ newHolderId: 8, reason: 'Falleció el titular.' });
    expect(call?.headers['Idempotency-Key']).toBeUndefined();
  });

  it('does not open for a role that cannot send that request', async () => {
    sessionStore.signedIn(account('president'));
    await open('type=unit_deactivation&id=45');
    expect(await screen.findByText('Solicitar baja')).toBeTruthy();
    expect(screen.getByText('No tiene permiso para esta acción.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enviar solicitud' })).toBeNull();
  });

  it('says so when the link is incomplete', async () => {
    sessionStore.signedIn(account('secretary'));
    await open('type=otra&id=45');
    expect(await screen.findByText('No se puede abrir esta solicitud.')).toBeTruthy();
  });
});

describe('text at 140 %', () => {
  it('G-11 is never cut', async () => {
    sessionStore.signedIn(account('block_leader'));
    setFontScale(1.4);
    await open('type=payment_cancellation&id=981&subject=Pago%20PG-000981');
    await screen.findByText('Solicitar cancelación');
    expect(largeTextProblems(screen.toJSON() as never)).toEqual([]);
  });
});
