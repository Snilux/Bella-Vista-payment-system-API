/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import type { SessionAccount } from '@bella-vista/shared';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { UNKNOWN_OUTCOME_MESSAGE } from '../../src/api/error-messages.js';
import { MISSING_FOLIO } from '../../src/features/billing/billing-view.js';
import { sessionStore } from '../../src/session/session-store.js';
import { apiError } from '../api/fake-api.js';
import { largeTextProblems, setFontScale } from '../ui/render.js';
import { fakeM6Api } from './fake-m6-api.js';

// M6 · El cobro con la carpeta app/ real y una API simulada (3.2 §10.3, §11.2, §12): G-04 opens
// F-02 without F-01; F-02 marks the months in order (the shared domain decides); F-03 registers
// with an Idempotency-Key created on the tap, sends once on a double tap, keeps the key for
// "Reintentar" (also after going back to F-02), goes back to F-02 on TOTAL_CHANGED and shows a
// repeated folio next to its field; P-06 "Ir a cobrar" pays the opening.

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

let server: ReturnType<typeof fakeM6Api>;

beforeEach(() => {
  const { createApiClient } = jest.requireActual('../../src/api/client.js');
  const { scriptedFetch, memoryTokens } = jest.requireActual('../api/fake-api.js');
  server = fakeM6Api();
  mockState.client = createApiClient({
    baseUrl: 'http://api.test:3000',
    tokens: memoryTokens({ access: 'access-0', refresh: 'refresh-0' }).store,
    onSessionEnded: () => undefined,
    fetchFn: scriptedFetch(server.route).fetchFn,
  });
  mockKeys = 0;
  setFontScale(1);
  sessionStore.signedIn(LEADER);
});

const open = (url: string) => renderRouter(APP, { initialUrl: url });
const month = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name}`) });
const checked = () =>
  screen
    .getAllByRole('checkbox')
    .filter((row) => row.props.accessibilityState?.checked)
    .map((row) => String(row.props.accessibilityLabel).split(',')[0]);
const paymentPosts = () => server.posts('/payments');

/** G-04 → Cobrar → F-02 with June and July marked → F-03 with the folio written. */
async function reviewJuneAndJuly(folio = '001300') {
  const router = await open('/common/units/45');
  await fireEvent.press(await screen.findByRole('button', { name: 'Cobrar' }));
  await fireEvent.press(await screen.findByRole('checkbox', { name: /^Julio 2026/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
  expect(await screen.findByText('Revise el pago')).toBeTruthy();
  await screen.findByText('Junio y julio 2026');
  await fireEvent.changeText(
    screen.getByLabelText('Folio del recibo de papel, obligatorio'),
    folio,
  );
  return router;
}

describe('G-04 · Familia (estado de cuenta)', () => {
  it('shows what the API says it owes and opens F-02 without F-01', async () => {
    const router = await open('/common/units/45');
    expect(await screen.findByText('$450.00')).toBeTruthy();
    expect(screen.getByText('Vencidos con recargo')).toBeTruthy();
    expect(screen.getByText('Pendiente (mes en curso)')).toBeTruthy();
    expect(screen.getAllByText('Recargo').length).toBe(4);
    await fireEvent.press(screen.getByRole('button', { name: 'Cobrar' }));
    expect(router.getPathname()).toBe('/common/new-payment/months');
  });

  it('a suspended family says so and offers no "Cobrar"', async () => {
    server.state.unit = { ...server.state.unit, status: 'suspended' };
    await open('/common/units/45');
    expect(await screen.findByText('Familia suspendida.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cobrar' })).toBeNull();
  });

  it('"Solicitar baja" and "Cambiar titular" open G-11 for this family', async () => {
    const router = await open('/common/units/45');
    await fireEvent.press(await screen.findByRole('button', { name: 'Solicitar baja' }));
    expect(router.getPathname()).toBe('/common/approval-request');
    expect(router.getSearchParams()).toMatchObject({ type: 'unit_deactivation', id: '45' });
  });
});

describe('F-02 · Elegir meses', () => {
  it('marks the earlier months and unmarks the later ones; advances wait for every due month', async () => {
    await open('/common/new-payment/months?unitId=45');
    expect(
      await screen.findByText('Tiene 4 meses vencidos. Cada mes vencido paga doble.'),
    ).toBeTruthy();
    await fireEvent.press(month('Agosto 2026'));
    expect(checked()).toEqual(['Junio 2026', 'Julio 2026', 'Agosto 2026']);
    expect(screen.getByText('Total (3 meses)')).toBeTruthy();
    expect(screen.getByText('$300.00')).toBeTruthy();

    // An advance month cannot be marked while October is unmarked.
    expect(month('Noviembre 2026').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(month('Junio 2026'));
    expect(checked()).toEqual([]);

    await fireEvent.press(month('Octubre 2026'));
    expect(checked()).toHaveLength(5);
    expect(month('Noviembre 2026').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(month('Diciembre 2026'));
    expect(checked()).toHaveLength(7);
  });

  it('says why "Continuar" is disabled without months', async () => {
    await open('/common/new-payment/months?unitId=45');
    expect(await screen.findByText('Elija al menos un mes.')).toBeTruthy();
  });
});

describe('F-03 · Revisar y folio', () => {
  it('registers with a new key and shows the data for the paper receipt', async () => {
    await reviewJuneAndJuly();
    expect(screen.getByText('$50.00 por mes')).toBeTruthy();
    expect(screen.getByText('Caja S1-M01')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(await screen.findByText('Pago registrado')).toBeTruthy();
    expect(screen.getByText('PG-0001000')).toBeTruthy();
    const [call] = paymentPosts();
    expect(call?.headers['Idempotency-Key']).toBe('key-1');
    expect(call?.body).toEqual({
      unitId: 45,
      periods: ['2026-06', '2026-07'],
      extraChargeIds: [],
      paperFolio: '001300',
      expectedTotal: 20_000,
    });
  });

  it('a double tap sends once', async () => {
    await reviewJuneAndJuly();
    const button = screen.getByRole('button', { name: 'Registrar pago' });
    await act(async () => {
      button.props.onClick?.();
      fireEvent.press(button);
      fireEvent.press(button);
    });
    expect(await screen.findByText('Pago registrado')).toBeTruthy();
    expect(paymentPosts()).toHaveLength(1);
  });

  it('without an answer says it may have gone in, and "Reintentar" sends the same key', async () => {
    await reviewJuneAndJuly();
    server.override((call) => call.url.endsWith('/v1/payments'), { networkError: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(await screen.findByText('No sabemos si se registró.')).toBeTruthy();
    expect(screen.getByText(UNKNOWN_OUTCOME_MESSAGE)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Pago registrado')).toBeTruthy();
    const keys = paymentPosts().map((call) => call.headers['Idempotency-Key']);
    expect(keys).toEqual(['key-1', 'key-1']);
    expect(server.state.payments.size).toBe(2); // the existing PG-000981 and this one
  });

  it('the unanswered key survives going back to F-02 (it lives in the flow)', async () => {
    await reviewJuneAndJuly();
    server.override((call) => call.url.endsWith('/v1/payments'), { networkError: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pago' }));
    await screen.findByText('No sabemos si se registró.');
    // Back to F-02 with the header's "Atrás" (the only way out while the answer is unknown).
    await fireEvent.press(screen.getAllByRole('button', { name: 'Atrás' }).at(-1) as never);
    expect(await screen.findByText('Hay un pago que no sabemos si se registró.')).toBeTruthy();
    // The months are locked: the retry must send the same data.
    expect(month('Agosto 2026').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Pago registrado')).toBeTruthy();
    expect(paymentPosts().map((call) => call.headers['Idempotency-Key'])).toEqual([
      'key-1',
      'key-1',
    ]);
  });

  it('TOTAL_CHANGED goes back to F-02 with the new total', async () => {
    const router = await reviewJuneAndJuly();
    server.override(
      (call) => call.url.endsWith('/v1/payments'),
      apiError(409, 'TOTAL_CHANGED', 'El total cambió.', { total: 25_000, expectedTotal: 20_000 }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pago' }));
    await waitFor(() => expect(router.getPathname()).toBe('/common/new-payment/months'));
    expect(
      await screen.findByText(
        'El total cambió: ahora es $250.00 (antes $200.00). Revise el resumen y confirme de nuevo.',
      ),
    ).toBeTruthy();
    // What was chosen is still there.
    expect(checked()).toEqual(['Junio 2026', 'Julio 2026']);
  });

  it('a folio already used in the receipt book shows next to its field', async () => {
    const router = await reviewJuneAndJuly('001234');
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(await screen.findByText('Este folio ya se usó en su talonario.')).toBeTruthy();
    expect(router.getPathname()).toBe('/common/new-payment/review');
    await fireEvent.changeText(screen.getByLabelText('Folio del recibo de papel, obligatorio'), '');
    expect(screen.getByText(MISSING_FOLIO)).toBeTruthy();
  });
});

describe('P-06 → cobro de la apertura', () => {
  it('"Ir a cobrar" pays the opening of the request', async () => {
    await open('/common/connection-requests/5/activate');
    await fireEvent.press(await screen.findByRole('button', { name: 'Ir a cobrar' }));
    expect(await screen.findByText('Cobrar apertura')).toBeTruthy();
    expect(screen.getByText('Apertura de toma')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('Revise el pago')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Folio del recibo de papel, obligatorio'),
      '002000',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(await screen.findByText('Pago registrado')).toBeTruthy();
    expect(paymentPosts()[0]?.body).toEqual({
      periods: [],
      extraChargeIds: [9],
      paperFolio: '002000',
      expectedTotal: 150_000,
    });
  });
});

describe('text at 140 %', () => {
  it.each([
    ['G-04', '/common/units/45', '$450.00'],
    ['F-02', '/common/new-payment/months?unitId=45', 'Elegir meses'],
  ])('%s is never cut', async (_id, url, text) => {
    setFontScale(1.4);
    await open(url);
    await screen.findAllByText(text);
    expect(largeTextProblems(screen.toJSON() as never)).toEqual([]);
  });
});
