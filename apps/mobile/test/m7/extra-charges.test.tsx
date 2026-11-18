/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import type { ExtraCharge, SessionAccount } from '@bella-vista/shared';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { sessionStore } from '../../src/session/session-store.js';
import { fakeM6Api } from '../m6/fake-m6-api.js';

// M7 · Cargos extraordinarios en el cobro (3.2 §6 M7; D-13, D-28): F-02 lists the family's
// pending charges and they are paid in the same payment as the months (extraChargeIds); a
// suspended family can still pay them; G-04 offers "Agregar cargo" only to the treasurer.

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

const LEADER: SessionAccount = {
  username: 'jm.s1m01',
  role: 'block_leader',
  blockId: 1,
  blockCode: 'S1-M01',
  fullName: 'Laura Méndez Ruiz',
  mustChangePassword: false,
};
const TREASURER: SessionAccount = {
  username: 'tesorero',
  role: 'treasurer',
  blockId: null,
  blockCode: null,
  fullName: 'Jorge Méndez Soto',
  mustChangePassword: false,
};

const RECONNECTION: ExtraCharge = {
  id: 77,
  fee: { id: 2, type: 'reconnection', name: 'Reinstalación' },
  amount: 30_000,
  chargedOn: '2026-10-20',
  target: 'unit',
  unitId: 45,
  connectionId: null,
  status: 'pending',
  paymentId: null,
  cancelledOn: null,
  cancellationReason: null,
};

let server: ReturnType<typeof fakeM6Api>;

beforeEach(() => {
  const { createApiClient } = jest.requireActual('../../src/api/client.js');
  const { scriptedFetch, memoryTokens } = jest.requireActual('../api/fake-api.js');
  server = fakeM6Api();
  server.state.charges = [RECONNECTION];
  mockState.client = createApiClient({
    baseUrl: 'http://api.test:3000',
    tokens: memoryTokens({ access: 'access-0', refresh: 'refresh-0' }).store,
    onSessionEnded: () => undefined,
    fetchFn: scriptedFetch(server.route).fetchFn,
  });
  mockKeys = 0;
  sessionStore.signedIn(LEADER);
});

const open = (url: string) => renderRouter(APP, { initialUrl: url });

describe('F-02 · Elegir meses with extra charges', () => {
  it('collects a reconnection together with the months in a single payment', async () => {
    await open('/common/units/45');
    expect(await screen.findByText('Conceptos pendientes')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cobrar' }));
    await fireEvent.press(await screen.findByRole('checkbox', { name: /^Julio 2026/ }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Reinstalación · $300.00' }));
    expect(screen.getByText('Total (2 meses y 1 concepto)')).toBeTruthy();
    expect(screen.getByText('$500.00')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Revise el pago')).toBeTruthy();
    expect(await screen.findByText('Reinstalación')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Folio del recibo de papel, obligatorio'),
      '001400',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(await screen.findByText('Pago registrado')).toBeTruthy();

    const payments = server.posts('/payments');
    expect(payments).toHaveLength(1);
    expect(payments[0]?.body).toEqual({
      unitId: 45,
      periods: ['2026-06', '2026-07'],
      extraChargeIds: [77],
      paperFolio: '001400',
      expectedTotal: 50_000,
    });
  });

  it('a charge alone can be collected; without months or charges it says why not', async () => {
    await open('/common/new-payment/months?unitId=45');
    await screen.findByRole('checkbox', { name: 'Reinstalación · $300.00' });
    expect(screen.getByText('Elija al menos un mes o un concepto.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Reinstalación · $300.00' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() =>
      expect(
        server.calls.some(
          (call) =>
            call.url.endsWith('/payments/preview') &&
            JSON.stringify((call.body as { extraChargeIds: number[] }).extraChargeIds) === '[77]',
        ),
      ).toBe(true),
    );
  });

  it('a suspended family pays its pending charges, not months', async () => {
    server.state.unit = { ...server.state.unit, status: 'suspended' };
    await open('/common/new-payment/months?unitId=45');
    expect(await screen.findByText('Puede cobrarle sus conceptos pendientes.')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /^Julio 2026/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Reinstalación · $300.00' })).toBeTruthy();
  });
});

describe('G-04 · Familia: conceptos pendientes', () => {
  it('the block leader sees them but cannot add or cancel one (D-28)', async () => {
    await open('/common/units/45');
    expect(await screen.findByText('Reinstalación')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agregar cargo' })).toBeNull();
  });

  it('the treasurer adds one', async () => {
    sessionStore.signedIn(TREASURER);
    await open('/common/units/45');
    await fireEvent.press(await screen.findByRole('button', { name: 'Agregar cargo' }));
    expect(await screen.findByText('¿A quién se carga?')).toBeTruthy();
  });
});
