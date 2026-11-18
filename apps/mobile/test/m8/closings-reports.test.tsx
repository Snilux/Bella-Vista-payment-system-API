/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import type { SessionAccount } from '@bella-vista/shared';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { blockSummaryRows, communitySummaryRows } from '../../src/features/reports/report-view.js';
import { sessionStore } from '../../src/session/session-store.js';
import { apiError } from '../api/fake-api.js';
import { REPORT } from '../m4/fake-m4-api.js';
import { fakeM6Api } from '../m6/fake-m6-api.js';
import { BLOCK_REPORT, fakeM8Api, LEADER_OCTOBER, TRICKY_NAME } from './fake-m8-api.js';

// M8 · Cortes, reportes y bitácora con la carpeta app/ real y una API simulada (3.2 §10, §12):
// the leader opens and counts the month's closing (notes required with a difference); the
// president reviews and closes; the member reviews but never closes nor captures; a closed
// closing is read only; a payment in a closed month says so in Spanish; the PDF of G-06 and
// G-07 is built from the same response the screen shows; R-05 filters and hides sensitive data.

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
// The PDF is built on the phone: the test keeps the HTML that would be printed and shared.
const mockPdf: { html: string[]; shared: string[] } = { html: [], shared: [] };
jest.mock('expo-print', () => ({
  printToFileAsync: ({ html }: { html: string }) => {
    mockPdf.html.push(html);
    return Promise.resolve({ uri: `file:///reporte-${mockPdf.html.length}.pdf` });
  },
}));
jest.mock('expo-sharing', () => ({
  shareAsync: (uri: string) => {
    mockPdf.shared.push(uri);
    return Promise.resolve();
  },
}));

const APP = path.resolve(__dirname, '../../app');

const person = (
  username: string,
  role: SessionAccount['role'],
  fullName: string,
): SessionAccount => ({
  username,
  role,
  blockId: role === 'block_leader' ? 1 : null,
  blockCode: role === 'block_leader' ? 'S1-M01' : null,
  fullName,
  mustChangePassword: false,
});
const LEADER = person('jm.s1m01', 'block_leader', 'Laura Méndez Ruiz');
const TREASURER = person('tesorero', 'treasurer', 'Jorge Méndez Soto');
const PRESIDENT = person('presidente', 'president', 'Roberto Salinas Mora');
const MEMBER = person('vocal', 'member', 'Ana Ruiz Pérez');

let server: ReturnType<typeof fakeM8Api>;

function useServer(route: ReturnType<typeof fakeM8Api>['route']) {
  const { createApiClient } = jest.requireActual('../../src/api/client.js');
  const { scriptedFetch, memoryTokens } = jest.requireActual('../api/fake-api.js');
  mockState.client = createApiClient({
    baseUrl: 'http://api.test:3000',
    tokens: memoryTokens({ access: 'access-0', refresh: 'refresh-0' }).store,
    onSessionEnded: () => undefined,
    fetchFn: scriptedFetch(route).fetchFn,
  });
}

beforeEach(() => {
  server = fakeM8Api();
  useServer(server.route);
  mockKeys = 0;
  mockPdf.html = [];
  mockPdf.shared = [];
});

const open = (url: string) => renderRouter(APP, { initialUrl: url });
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const disabled = (name: string | RegExp) =>
  Boolean(button(name).props.accessibilityState?.disabled);

describe('J-05 · Corte del mes', () => {
  it('opens the month the API proposes and counts it; a difference needs a note', async () => {
    sessionStore.signedIn(LEADER);
    await open('/block_leader/my-cashbox/closing');
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Preparar corte de octubre 2026' }),
    );
    expect(server.posts('/closings')[0]?.body).toEqual({ type: 'monthly', period: '2026-10' });

    // The API's figures, and the count.
    expect(await screen.findByText('Debe haber')).toBeTruthy();
    expect(screen.getByText('$3,450.00')).toBeTruthy();
    expect(screen.getByText('-$1,000.00')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Efectivo contado, obligatorio'), '3,400.00');
    expect(screen.getByText('Faltan $50.00. Escriba una observación.')).toBeTruthy();
    expect(disabled('Guardar conteo')).toBe(true);
    await fireEvent.changeText(
      screen.getByLabelText('Observaciones, obligatorio'),
      'Faltante en la entrega EN-000022',
    );
    await fireEvent.press(button('Guardar conteo'));
    await waitFor(() => expect(server.posts('/closings/51/count')).toHaveLength(1));
    expect(server.posts('/closings/51/count')[0]?.body).toEqual({
      countedCash: 340_000,
      notes: 'Faltante en la entrega EN-000022',
    });
    expect(await screen.findByText('Conteo guardado.')).toBeTruthy();
    // A leader neither reviews nor closes.
    expect(screen.queryByRole('button', { name: 'Marcar como revisado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cerrar corte' })).toBeNull();
  });

  it('with no finished month to close, it says so', async () => {
    sessionStore.signedIn(LEADER);
    server.state.nextBlock = null;
    await open('/block_leader/my-cashbox/closing');
    expect(await screen.findByText('No tiene cortes pendientes.')).toBeTruthy();
  });
});

describe('G-08 · Corte (detalle): review and close', () => {
  it('the president reviews and closes; the closed closing is read only', async () => {
    sessionStore.signedIn(PRESIDENT);
    server.state.closings = [
      LEADER_OCTOBER({
        status: 'counted',
        countedCash: 340_000,
        difference: -5_000,
        notes: 'Faltante',
      }),
    ];
    await open('/common/closings/41');
    expect(await screen.findByText('Corte de octubre 2026')).toBeTruthy();
    expect(screen.getByText('Diferencia')).toBeTruthy();
    expect(screen.getByText('-$50.00')).toBeTruthy();
    await fireEvent.press(button('Marcar como revisado'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Cerrar corte' }));
    expect(
      await screen.findByText(
        /Después de cerrarlo no se podrá registrar ningún movimiento con fecha de octubre/,
      ),
    ).toBeTruthy();
    await fireEvent.press(button('Sí, cerrar'));
    expect(await screen.findByLabelText('Estado: Cerrado')).toBeTruthy();
    expect(server.posts('/closings/41/close')).toHaveLength(1);
    // Read only: no action left.
    for (const name of [
      'Marcar como revisado',
      'Cerrar corte',
      'Guardar conteo',
      'Corregir conteo',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getByText(/Corte cerrado: solo de consulta/)).toBeTruthy();
  });

  it('the member reviews but never closes nor captures', async () => {
    sessionStore.signedIn(MEMBER);
    server.state.closings = [
      LEADER_OCTOBER({ status: 'counted', countedCash: 345_000, difference: 0 }),
    ];
    await open('/common/closings/41');
    await fireEvent.press(await screen.findByRole('button', { name: 'Marcar como revisado' }));
    expect(await screen.findByLabelText('Estado: Revisado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cerrar corte' })).toBeNull();
    expect(screen.queryByLabelText('Efectivo contado, obligatorio')).toBeNull();
    expect(server.posts('/closings/41/close')).toHaveLength(0);
  });

  it('R-04 offers "Por cerrar" to the president only', async () => {
    sessionStore.signedIn(MEMBER);
    server.state.closings = [
      LEADER_OCTOBER({ status: 'counted', countedCash: 345_000, difference: 0 }),
    ];
    await open('/member/closings');
    expect(await screen.findByText('Manzana S1-M01')).toBeTruthy();
    expect(screen.getByText('Corte de octubre 2026 · preparó Laura Méndez Ruiz')).toBeTruthy();
    expect(screen.queryByLabelText('Filtro: Por cerrar')).toBeNull();
  });
});

describe('T-13 · Cortes', () => {
  it('lists every cashbox of the month and prepares the committee closing', async () => {
    sessionStore.signedIn(TREASURER);
    server.state.mine = 'committee';
    server.state.preparer = 'treasurer';
    const router = await open('/treasurer/more/closings');
    expect(await screen.findByText('Caja del comité')).toBeTruthy();
    expect(screen.getAllByText('Por hacer').length).toBeGreaterThan(0);
    expect(screen.getByText('Manzana S1-M02')).toBeTruthy();
    await fireEvent.press(button('Preparar corte del comité'));
    await waitFor(() => expect(router.getPathname()).toBe('/common/closings/51'));
    expect(server.posts('/closings')[0]?.body).toEqual({ type: 'monthly', period: '2026-10' });
  });

  it('creates the extraordinary closing of a block (the handover record of S-07)', async () => {
    sessionStore.signedIn(TREASURER);
    server.state.preparer = 'treasurer';
    const router = await open('/treasurer/more/closings');
    await fireEvent.press(await screen.findByRole('button', { name: 'Corte extraordinario' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Manzana: sin elegir' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Manzana S1-M01' }));
    await fireEvent.press(button('Preparar corte extraordinario'));
    await waitFor(() => expect(router.getPathname()).toBe('/common/closings/51'));
    expect(server.posts('/closings')[0]?.body).toEqual({ type: 'extraordinary', cashboxId: 10 });
  });
});

describe('Periodo cerrado', () => {
  it('a payment in a closed month says so in Spanish (PERIOD_CLOSED)', async () => {
    sessionStore.signedIn(LEADER);
    const billing = fakeM6Api();
    useServer(billing.route);
    billing.override(
      (call) => call.method === 'POST' && call.url.endsWith('/v1/payments'),
      apiError(409, 'PERIOD_CLOSED', 'cashbox 2 has a closed closing'),
    );
    await open('/common/units/45');
    await fireEvent.press(await screen.findByRole('button', { name: 'Cobrar' }));
    await fireEvent.press(await screen.findByRole('checkbox', { name: /^Julio 2026/ }));
    await fireEvent.press(button('Continuar'));
    await screen.findByText('Revise el pago');
    await fireEvent.changeText(
      screen.getByLabelText('Folio del recibo de papel, obligatorio'),
      '001500',
    );
    await fireEvent.press(button('Registrar pago'));
    expect(
      await screen.findByText(
        'Ese mes ya tiene su corte cerrado y no admite movimientos. Registre la operación con una fecha del mes abierto; si es una corrección, se hace en el mes abierto.',
      ),
    ).toBeTruthy();
  });
});

describe('G-06 / G-07 · PDF', () => {
  it('G-06 exports the same figures the screen shows, with the names escaped', async () => {
    sessionStore.signedIn(LEADER);
    await open('/common/reports/block');
    expect(await screen.findByText('Familias activas')).toBeTruthy();
    expect(
      screen.getByText(
        new RegExp(`^U-000001 · ${TRICKY_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      ),
    ).toBeTruthy();
    await fireEvent.press(button('Exportar a PDF'));
    await waitFor(() => expect(mockPdf.shared).toHaveLength(1));
    const html = mockPdf.html[0] ?? '';
    for (const row of blockSummaryRows(BLOCK_REPORT)) {
      // On screen and in the PDF: the same label and value.
      expect(screen.getByText(row.label)).toBeTruthy();
      expect(screen.getAllByText(row.value).length).toBeGreaterThan(0);
      expect(html).toContain(`<td>${row.label}</td><td class="amount">${row.value}</td>`);
    }
    expect(html).toContain('Ñandú &lt;López&gt; &amp; &quot;Hijos&quot;');
    expect(html).not.toContain('<López>');
    expect(html).toContain('Comité de Agua Bella Vista');
    expect(html).toMatch(
      /Generado el \d{4}-\d{2}-\d{2} \d{2}:\d{2} por Laura Méndez Ruiz \(Jefe de manzana · S1-M01\)/,
    );
  });

  it('G-07 exports the same totals the screen shows', async () => {
    sessionStore.signedIn(PRESIDENT);
    await open('/president/reports');
    expect(await screen.findByText('Fondos comunitarios')).toBeTruthy();
    await fireEvent.press(button('Exportar a PDF'));
    await waitFor(() => expect(mockPdf.shared).toHaveLength(1));
    const html = mockPdf.html[0] ?? '';
    for (const row of communitySummaryRows(REPORT)) {
      expect(screen.getAllByText(row.value).length).toBeGreaterThan(0);
      expect(html).toContain(`<td>${row.label}</td><td class="amount">${row.value}</td>`);
    }
    expect(html).toContain('Presidente');
  });
});

describe('R-05 · Bitácora', () => {
  it('filters by table and role and never shows a password, token or hash', async () => {
    sessionStore.signedIn(PRESIDENT);
    await open('/president/more/audit-log');
    expect(await screen.findByText('Alta: Pago PG-202610-000981')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Filtro: Pagos'));
    await waitFor(() =>
      expect(server.calls.some((call) => call.url.includes('tableName=payment'))).toBe(true),
    );
    await fireEvent.press(screen.getByLabelText('Filtro: Todo'));
    await fireEvent.press(screen.getByRole('button', { name: 'Cargo: Todos' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Superadministrador' }));
    await waitFor(() =>
      expect(server.calls.some((call) => call.url.includes('role=superadmin'))).toBe(true),
    );
    await fireEvent.press(await screen.findByText('Contraseña restablecida: Cuenta'));
    expect(await screen.findByText('Olvidó su contraseña')).toBeTruthy();
    expect(screen.getByText('mustChangePassword')).toBeTruthy();
    expect(screen.queryByText('passwordHash')).toBeNull();
    expect(screen.queryByText(/argon2id/)).toBeNull();
    expect(screen.queryByText('refreshToken')).toBeNull();
  });
});

describe('V-01 · Inicio del vocal', () => {
  it('only consults: funds, closings to review and the reports, no action', async () => {
    sessionStore.signedIn(MEMBER);
    await open('/member/home');
    expect(await screen.findByText('Vocal del comité · solo consulta')).toBeTruthy();
    expect(await screen.findByText('Fondos comunitarios esperados')).toBeTruthy();
    const labels = screen
      .getAllByRole('button')
      .map((item) => String(item.props.accessibilityLabel));
    for (const forbidden of [/Registrar/, /Cobrar/, /Autoriz/, /Cerrar/, /Preparar/]) {
      expect(labels.some((label) => forbidden.test(label))).toBe(false);
    }
    await fireEvent.press(screen.getByRole('button', { name: /^Padrón por manzana/ }));
    expect(await screen.findByRole('button', { name: 'Manzana: sin elegir' })).toBeTruthy();
  });
});
