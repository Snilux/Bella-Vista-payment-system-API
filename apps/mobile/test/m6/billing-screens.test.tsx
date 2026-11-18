/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import type { SessionAccount } from '@bella-vista/shared';
import { addMonths } from '@bella-vista/shared';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { businessToday } from '../../src/features/forms/business-date.js';
import { currentPeriod } from '../../src/features/registry/registry-view.js';
import { sessionStore } from '../../src/session/session-store.js';
import { largeTextProblems, setFontScale } from '../ui/render.js';
import { fakeM6Api, paymentOf } from './fake-m6-api.js';

// M6 · Pagos, inicio del jefe, tarifas y conceptos, y R-03 con el pago real (3.2 §10.2, §10.5,
// §10.6, §10.8): G-05 offers replacement and cancellation (none when cancelled); G-10 has no cost
// and shows a used folio on its field; J-01 shows "Debo tener"; T-10 leaves a new rate pending;
// T-11 adds an amount without editing the previous one; R-03 shows the payment of a cancellation.

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

const account = (role: SessionAccount['role']): SessionAccount => ({
  username: role === 'block_leader' ? 'jm.s1m01' : role,
  role,
  blockId: role === 'block_leader' ? 1 : null,
  blockCode: role === 'block_leader' ? 'S1-M01' : null,
  fullName: role === 'block_leader' ? 'Laura Méndez Ruiz' : 'Roberto Sánchez Gil',
  mustChangePassword: false,
});

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
  setFontScale(1);
  sessionStore.signedIn(account('block_leader'));
});

const open = (url: string) => renderRouter(APP, { initialUrl: url });

describe('G-05 · Detalle de pago', () => {
  it('shows months, cashbox and receipt, and opens G-11 to request the cancellation', async () => {
    const router = await open('/common/payments/981');
    expect(await screen.findByText('Pago PG-000981')).toBeTruthy();
    expect(screen.getAllByText('$50.00 + recargo $50.00')).toHaveLength(2);
    expect(screen.getByText('001234 (original)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Solicitar cancelación' }));
    expect(router.getPathname()).toBe('/common/approval-request');
    expect(router.getSearchParams()).toMatchObject({
      type: 'payment_cancellation',
      id: '981',
      subject: 'Pago PG-000981 · $200.00',
    });
  });

  it('a cancelled payment says "Cancelado" and offers no action', async () => {
    server.state.payments.set(981, paymentOf(981, { cancelled: true }));
    await open('/common/payments/981');
    expect(await screen.findByText('Cancelado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reposición de recibo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Solicitar cancelación' })).toBeNull();
  });
});

describe('G-10 · Reposición de recibo', () => {
  it('a used folio shows next to its field; a new one adds the replacement', async () => {
    const router = await open('/common/payments/981');
    await fireEvent.press(await screen.findByRole('button', { name: 'Reposición de recibo' }));
    expect(
      await screen.findByText('La reposición no tiene costo y no cambia su caja.'),
    ).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Folio del nuevo recibo, obligatorio'),
      '001234',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar reposición' }));
    expect(await screen.findByText('Este folio ya se usó en su talonario.')).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('Folio del nuevo recibo, obligatorio'),
      '001301',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar reposición' }));
    await waitFor(() => expect(router.getPathname()).toBe('/common/payments/981'));
    expect(await screen.findByText('001301 (reposición)')).toBeTruthy();
    expect(server.posts('/payments/981/replacements').at(-1)?.body).toEqual({
      paperFolio: '001301',
    });
  });
});

describe('J-01 · Inicio del jefe', () => {
  it('shows "Debo tener" from Mi caja and the pending families of the block', async () => {
    await open('/block_leader/home');
    expect(await screen.findByText('$3,450.00')).toBeTruthy();
    expect(screen.getByText('Hola, Laura')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Familias con recargo: 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Familias con atraso: 2' })).toBeTruthy();
  });
});

describe('T-10 · Tarifas', () => {
  it('shows the rate in force and the pending one, and a new one goes to the president', async () => {
    sessionStore.signedIn(account('treasurer'));
    const router = await open('/treasurer/more/rates');
    expect(await screen.findByText('$50.00')).toBeTruthy();
    expect(
      screen.getByText(
        'La tarifa de $60.00 desde enero 2027 espera la autorización del presidente.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar tarifa' }));
    expect(router.getPathname()).toBe('/treasurer/more/rates/new');

    await fireEvent.changeText(await screen.findByLabelText('Importe mensual, obligatorio'), '55');
    await fireEvent.press(screen.getByLabelText(/^Acuerdo de junta/));
    await fireEvent.press(await screen.findByRole('radio', { name: /^AC-000047/ }));
    // The approval date comes from the meeting.
    expect(screen.getByLabelText('Fecha de aprobación, obligatorio').props.value).toBe(
      '2026-10-24',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar al presidente' }));
    expect(await screen.findByText('Enviada al presidente')).toBeTruthy();
    expect(server.posts('/rates')[0]?.body).toEqual({
      effectivePeriod: addMonths(currentPeriod(), 1),
      amount: 5_500,
      approvedOn: '2026-10-24',
      agreementId: 47,
      reason: null,
    });
  });
});

describe('T-11 · Conceptos', () => {
  it('adds a new amount from a date and keeps the previous ones', async () => {
    sessionStore.signedIn(account('treasurer'));
    await open('/treasurer/more/fees');
    expect(await screen.findByText('Sin importe vigente')).toBeTruthy();
    await fireEvent.press(screen.getByText('Apertura de toma'));
    expect(await screen.findByText('Historial')).toBeTruthy();
    expect(screen.getByText('Desde 2025-01-01')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Importe nuevo, obligatorio'), '1,800');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar importe' }));
    await waitFor(() => expect(server.posts('/fees/1/amounts')).toHaveLength(1));
    expect(server.posts('/fees/1/amounts')[0]?.body).toEqual({
      amount: 180_000,
      effectiveFrom: businessToday(),
    });
    expect(await screen.findByText('$1,800.00')).toBeTruthy();
  });
});

describe('R-03 · con el pago real (subject)', () => {
  it('shows the payment of a cancellation request and opens it', async () => {
    sessionStore.signedIn(account('president'));
    const router = await open('/president/approvals/32');
    expect(await screen.findByText('Cancelar el pago PG-000981 ($200.00)')).toBeTruthy();
    expect(await screen.findByText('PG-000981')).toBeTruthy();
    expect(screen.getByText('Junio y julio 2026')).toBeTruthy();
    expect(screen.getByText('001234')).toBeTruthy();
    expect(screen.getByText(/el importe sale de la caja S1-M01/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver el pago' }));
    expect(router.getPathname()).toBe('/common/payments/981');
  });
});

describe('text at 140 %', () => {
  it.each([
    ['G-05', '/common/payments/981', 'Pago PG-000981'],
    ['J-01', '/block_leader/home', '$3,450.00'],
  ])('%s is never cut', async (_id, url, text) => {
    setFontScale(1.4);
    await open(url);
    await screen.findAllByText(text);
    expect(largeTextProblems(screen.toJSON() as never)).toEqual([]);
  });
});
