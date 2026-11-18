/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import type { SessionAccount } from '@bella-vista/shared';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { UNKNOWN_OUTCOME_MESSAGE } from '../../src/api/error-messages.js';
import { SAVED_NOT_PAID } from '../../src/features/committee/committee-view.js';
import {
  UNKNOWN_LEAVE_MESSAGE,
  UNKNOWN_LEAVE_TITLE,
} from '../../src/features/forms/DiscardChangesSheet.js';
import { sessionStore } from '../../src/session/session-store.js';
import { apiError } from '../api/fake-api.js';
import { largeTextProblems, setFontScale } from '../ui/render.js';
import { expense, fakeM7Api, handover } from './fake-m7-api.js';

// M7 · Cajas y comité con la carpeta app/ real y una API simulada (3.2 §10.5, §10.6, §12): a
// handover confirmed with a shortfall moves both cashboxes by the amount received and leaves the
// difference to clarify (G-11 with the fixed amount); a pending handover is withdrawn; an
// expense without balance is blocked, "Guardar y pagar" keeps each step's key (a lost answer
// never duplicates the expense) and says when it stayed pending; the plumber's payment is not
// duplicated on retry; J-03 explains its limit; T-12, G-09 and R-03 show the API's data.

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
  username: 'jm.s1m03',
  role: 'block_leader',
  blockId: 3,
  blockCode: 'S1-M03',
  fullName: 'María López Torres',
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
const PRESIDENT: SessionAccount = {
  username: 'presidente',
  role: 'president',
  blockId: null,
  blockCode: null,
  fullName: 'Rosa Díaz Luna',
  mustChangePassword: false,
};

let server: ReturnType<typeof fakeM7Api>;

beforeEach(() => {
  const { createApiClient } = jest.requireActual('../../src/api/client.js');
  const { scriptedFetch, memoryTokens } = jest.requireActual('../api/fake-api.js');
  server = fakeM7Api();
  mockState.client = createApiClient({
    baseUrl: 'http://api.test:3000',
    tokens: memoryTokens({ access: 'access-0', refresh: 'refresh-0' }).store,
    onSessionEnded: () => undefined,
    fetchFn: scriptedFetch(server.route).fetchFn,
  });
  mockKeys = 0;
  setFontScale(1);
});

const as = (account: SessionAccount) => {
  sessionStore.signedIn(account);
  server.state.mine =
    account.role === 'treasurer' ? 'committee' : account.role === 'president' ? 'support' : 'block';
};
const open = (url: string) => renderRouter(APP, { initialUrl: url });
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const disabled = (name: string | RegExp) =>
  Boolean(button(name).props.accessibilityState?.disabled);
const keyOf = (call: { headers: Record<string, string> } | undefined) =>
  call?.headers['Idempotency-Key'];
const choose = async (select: string, option: string | RegExp) => {
  await fireEvent.press(screen.getByRole('button', { name: `${select}: sin elegir` }));
  await fireEvent.press(screen.getByRole('radio', { name: option }));
};

describe('J-02 · Mi caja', () => {
  it('a pending handover is still in the cashbox: "Por confirmar" in "Debo tener"', async () => {
    as(LEADER);
    await open('/block_leader/my-cashbox');
    expect(await screen.findByText('$5,000.00')).toBeTruthy();
    expect(screen.getByText('Por confirmar')).toBeTruthy();
    expect(screen.getByText('$3,000.00')).toBeTruthy();
    expect(screen.getByText('Saldo inicial')).toBeTruthy();
    expect(screen.getByText('Manzana S1-M03')).toBeTruthy();
    expect(button('Movimientos')).toBeTruthy();
  });
});

describe('J-03 · Preparar entrega', () => {
  it('explains next to the amount why it cannot exceed what the leader may hand over', async () => {
    as(LEADER);
    await open('/block_leader/my-cashbox/new-handover');
    const amount = await screen.findByLabelText('Importe a entregar, obligatorio');
    await fireEvent.changeText(amount, '4,000.00');
    expect(
      await screen.findAllByText(
        'Es mayor a lo que debe tener: puede entregar hasta $2,000.00 (ya tiene $3,000.00 en entregas por confirmar).',
      ),
    ).not.toHaveLength(0);
    expect(disabled('Preparar entrega')).toBe(true);
    expect(server.posts('/handovers')).toHaveLength(0);

    await fireEvent.changeText(amount, '1,500.00');
    await fireEvent.press(button('Preparar entrega'));
    expect(await screen.findByText('Entrega preparada')).toBeTruthy();
    const [sent] = server.posts('/handovers');
    expect(sent?.body).toEqual({ declaredAmount: 150_000 });
    expect(keyOf(sent)).toBe('key-1');
  });
});

describe('J-03 · leaving without an answer (M9)', () => {
  it('warns that it may be registered instead of "se perderá"', async () => {
    as(LEADER);
    const router = await open('/block_leader/my-cashbox');
    await fireEvent.press(await screen.findByRole('button', { name: 'Preparar entrega' }));
    await fireEvent.changeText(
      await screen.findByLabelText('Importe a entregar, obligatorio'),
      '1,500.00',
    );
    server.loseAnswer((call) => call.url.endsWith('/handovers'));
    await fireEvent.press(button('Preparar entrega'));
    expect(await screen.findByText(UNKNOWN_OUTCOME_MESSAGE)).toBeTruthy();

    await fireEvent.press(button('Atrás'));
    expect(screen.getByText(UNKNOWN_LEAVE_TITLE)).toBeTruthy();
    expect(screen.getByText(UNKNOWN_LEAVE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText('Lo que escribió en este formulario se perderá.')).toBeNull();
    await fireEvent.press(button('Sí, salir'));
    await waitFor(() => expect(router.getPathname()).toBe('/block_leader/my-cashbox'));
  });
});

describe('J-04 · Mis entregas', () => {
  it('withdraws a pending handover (no key: the API does not key it)', async () => {
    as(LEADER);
    await open('/block_leader/my-cashbox/handovers');
    await fireEvent.press(await screen.findByText('EN-202610-000031 · $3,000.00'));
    expect(await screen.findByText('¿Retirar la entrega?')).toBeTruthy();
    await fireEvent.press(button('Sí, retirar'));
    await waitFor(() => expect(server.posts('/handovers/31/withdraw')).toHaveLength(1));
    expect(keyOf(server.posts('/handovers/31/withdraw')[0])).toBeUndefined();
    expect(await screen.findByText('Retirada · declarado $3,000.00')).toBeTruthy();
    expect(server.state.handovers[0]?.status).toBe('withdrawn');
  });

  it('shows the received amount and the shortfall of a confirmed handover', async () => {
    as(LEADER);
    server.state.handovers = [
      handover({ status: 'with_difference', receivedAmount: 295_000, difference: 5_000 }),
    ];
    await open('/block_leader/my-cashbox/handovers');
    expect(await screen.findByText('Recibido $2,950.00 · faltan $50.00')).toBeTruthy();
  });
});

describe('T-03 · Confirmar entrega', () => {
  it('confirmed with a shortfall: both cashboxes move by the amount received and the difference stays visible', async () => {
    as(TREASURER);
    await open('/treasurer/handovers/31');
    expect(await screen.findByText('María López Torres · Manzana S1-M03')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Importe recibido, obligatorio'), '2,950.00');
    expect(
      await screen.findByText(
        'Diferencia: faltan $50.00. Quedarán en la caja del jefe hasta aclararlo.',
      ),
    ).toBeTruthy();

    // A clear notice before confirming: nothing is sent until "Sí, confirmar".
    await fireEvent.press(button('Confirmar entrega'));
    expect(await screen.findByText('¿Confirmar con faltante?')).toBeTruthy();
    expect(server.posts('/handovers/31/confirm')).toHaveLength(0);
    await fireEvent.press(button('Sí, confirmar'));

    expect(await screen.findByText('Entrega confirmada con faltante')).toBeTruthy();
    const [sent] = server.posts('/handovers/31/confirm');
    expect(sent?.body).toEqual({ receivedAmount: 295_000 });
    expect(keyOf(sent)).toBe('key-1');
    // D-16: the block cashbox goes down and the committee's goes up by what was received.
    expect(server.state.block.balance).toBe(500_000 - 295_000);
    expect(server.state.committee.balance).toBe(1_240_000 + 295_000);
    expect(
      screen.getByText(
        'La caja del comité subió $2,950.00 y la de Manzana S1-M03 bajó lo mismo. Faltan $50.00: siguen en la caja del jefe hasta aclararlos.',
      ),
    ).toBeTruthy();

    // The clarification: G-11 with the fixed amount (the whole difference, negative).
    await fireEvent.press(button('Solicitar aclaración'));
    expect(await screen.findByText('Importe de la aclaración')).toBeTruthy();
    expect(screen.getByText('-$50.00')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Motivo, obligatorio'), 'Billete falso');
    await fireEvent.press(button('Enviar solicitud'));
    expect(await screen.findByText('Enviada al presidente')).toBeTruthy();
    const [adjustment] = server.posts('/adjustments');
    expect(adjustment?.body).toEqual({ handoverId: 31, amount: -5_000, reason: 'Billete falso' });
    expect(keyOf(adjustment)).toBe('key-2');
  });

  it('a received amount above the declared one is explained and not sent', async () => {
    as(TREASURER);
    await open('/treasurer/handovers/31');
    await fireEvent.changeText(
      await screen.findByLabelText('Importe recibido, obligatorio'),
      '3,100.00',
    );
    expect(await screen.findAllByText(/No puede ser mayor que lo declarado/)).not.toHaveLength(0);
    expect(disabled('Confirmar entrega')).toBe(true);
  });

  it('the exact amount is confirmed without the sheet', async () => {
    as(TREASURER);
    await open('/treasurer/handovers/31');
    await fireEvent.changeText(
      await screen.findByLabelText('Importe recibido, obligatorio'),
      '3,000.00',
    );
    await fireEvent.press(button('Confirmar entrega'));
    expect(await screen.findByText('Entrega confirmada')).toBeTruthy();
    expect(server.state.handovers[0]?.status).toBe('confirmed');
  });
});

describe('T-06 · Registrar gasto', () => {
  async function fill(amount: string) {
    await open('/treasurer/cashbox/new-expense');
    await screen.findByText('Caja del comité: $12,400.00');
    await choose('Categoría', 'Reparaciones');
    await fireEvent.changeText(screen.getByLabelText('Descripción, obligatorio'), 'Válvula');
    await fireEvent.changeText(screen.getByLabelText('Importe, obligatorio'), amount);
    await choose('Acuerdo de junta', /^AC-000045/);
  }

  it('without enough balance "Guardar y pagar" is blocked with the reason; it can be saved pending', async () => {
    as(TREASURER);
    await fill('20,000.00');
    expect(disabled('Guardar y pagar')).toBe(true);
    expect(
      screen.getAllByText(
        'No hay saldo suficiente: la caja del comité tiene $12,400.00 y el gasto es de $20,000.00. Guárdelo como pendiente y páguelo cuando haya saldo.',
      ).length,
    ).toBeGreaterThan(0);
    await fireEvent.press(button('Guardar como pendiente'));
    expect(await screen.findByText('Gasto registrado')).toBeTruthy();
    expect(server.posts('/expenses')).toHaveLength(1);
    expect(server.calls.some((call) => call.url.endsWith('/pay'))).toBe(false);
  });

  it('"Guardar y pagar": a lost answer while registering is retried with the same key, never twice', async () => {
    as(TREASURER);
    await fill('1,800.00');
    server.loseAnswer((call) => call.method === 'POST' && call.url.endsWith('/v1/expenses'));
    await fireEvent.press(button('Guardar y pagar'));
    expect(await screen.findByText(UNKNOWN_OUTCOME_MESSAGE)).toBeTruthy();
    await fireEvent.press(button('Reintentar'));

    expect(await screen.findByText('Gasto pagado')).toBeTruthy();
    const registers = server.posts('/expenses');
    expect(registers.map(keyOf)).toEqual(['key-1', 'key-1']);
    // One expense, paid once, with its own key.
    expect(server.state.expenses.filter((item) => item.description === 'Válvula')).toHaveLength(1);
    const pays = server.calls.filter((call) => call.url.endsWith('/pay'));
    expect(pays.map(keyOf)).toEqual(['key-2']);
    expect(server.state.committee.balance).toBe(1_240_000 - 180_000);
  });

  it('"Guardar y pagar": paying without balance leaves it registered and pending, and says so', async () => {
    as(TREASURER);
    await fill('1,800.00');
    // The balance changed meanwhile (another device paid something).
    server.override((call) => call.url.endsWith('/pay'), apiError(409, 'INSUFFICIENT_BALANCE'));
    await fireEvent.press(button('Guardar y pagar'));
    expect(await screen.findByText(SAVED_NOT_PAID)).toBeTruthy();
    expect(server.posts('/expenses')).toHaveLength(1);
    expect(server.state.expenses[0]?.status).toBe('pending_payment');
    await fireEvent.press(button('Ver el gasto'));
    expect(await screen.findByText(/^Gasto GA-/)).toBeTruthy();
  });
});

describe('T-07 · Detalle de gasto', () => {
  it('blocks paying without balance, with the reason', async () => {
    as(TREASURER);
    server.state.expenses = [expense({ amount: 2_000_000 })];
    await open('/treasurer/cashbox/expenses/89');
    expect(await screen.findByText('Gasto GA-202610-000089')).toBeTruthy();
    await waitFor(() => expect(disabled('Marcar como pagado')).toBe(true));
    expect(screen.getAllByText(/No hay saldo suficiente/).length).toBeGreaterThan(0);
  });

  it('pays with its key and says what remains; rejects with a reason', async () => {
    as(TREASURER);
    await open('/treasurer/cashbox/expenses/89');
    expect(
      await screen.findByText(
        'Al pagarlo se descuenta de la caja del comité. Quedarán $10,600.00.',
      ),
    ).toBeTruthy();
    await fireEvent.press(button('Marcar como pagado'));
    expect(await screen.findByLabelText('Estado: Pagado')).toBeTruthy();
    expect(keyOf(server.calls.find((call) => call.url.endsWith('/pay')))).toBe('key-1');
    expect(button('Solicitar reintegro')).toBeTruthy();
  });

  it('rejects with a reason', async () => {
    as(TREASURER);
    await open('/treasurer/cashbox/expenses/89');
    await fireEvent.press(await screen.findByRole('button', { name: 'Rechazar gasto' }));
    await fireEvent.changeText(
      screen.getByLabelText('Motivo del rechazo, obligatorio'),
      'No se hizo la reparación',
    );
    // The sheet's button comes before the footer's.
    const [confirm] = screen.getAllByRole('button', { name: 'Rechazar gasto' });
    if (!confirm) throw new Error('no button');
    await fireEvent.press(confirm);
    expect(await screen.findByLabelText('Estado: Rechazado')).toBeTruthy();
    expect(server.posts('/expenses/89/reject')[0]?.body).toEqual({
      reason: 'No se hizo la reparación',
    });
  });

  it('"Solicitar reintegro" opens G-11 for the expense', async () => {
    as(TREASURER);
    server.state.expenses = [expense({ status: 'paid', paidOn: '2026-10-25' })];
    const router = await open('/treasurer/cashbox/expenses/89');
    await fireEvent.press(await screen.findByRole('button', { name: 'Solicitar reintegro' }));
    expect(router.getPathname()).toBe('/common/approval-request');
    expect(router.getSearchParams()).toMatchObject({ type: 'expense_refund', id: '89' });
  });
});

describe('T-08 / T-09 · Fontanero', () => {
  it('T-08 shows the salary in force, the payments and the salary history', async () => {
    as(TREASURER);
    await open('/treasurer/more/plumber');
    expect(await screen.findByText('Pedro Ramírez Cruz · 222 987 6543')).toBeTruthy();
    expect(screen.getByText('Quincenal')).toBeTruthy();
    expect(screen.getByText('2026-10-01 al 2026-10-15')).toBeTruthy();
    expect(screen.getByText('$2,500.00 · Quincenal')).toBeTruthy();
  });

  it('T-09: the payment is not duplicated when the answer is lost and it is retried', async () => {
    as(TREASURER);
    await open('/treasurer/more/plumber/pay?id=2');
    expect(await screen.findByText('Salario fijo')).toBeTruthy();
    expect(screen.getByText('Quedará')).toBeTruthy();
    server.loseAnswer((call) => call.url.endsWith('/plumbers/2/payments'));
    await fireEvent.press(button('Registrar pago'));
    expect(await screen.findByText(UNKNOWN_OUTCOME_MESSAGE)).toBeTruthy();
    await fireEvent.press(button('Reintentar'));
    await waitFor(() => expect(server.posts('/plumbers/2/payments')).toHaveLength(2));
    expect(await screen.findByText('Pago registrado')).toBeTruthy();

    const posts = server.posts('/plumbers/2/payments');
    expect(posts.map(keyOf)).toEqual(['key-1', 'key-1']);
    expect(posts[0]?.body).toEqual(posts[1]?.body);
    // Applied once: one new payment and one discount of the salary.
    expect(server.state.plumber.payments).toHaveLength(2);
    expect(server.state.committee.balance).toBe(1_240_000 - 250_000);
  });
});

describe('T-12 · Saldos iniciales', () => {
  it('one row per cashbox with its status; only one without a pending or authorized one is captured', async () => {
    as(TREASURER);
    await open('/treasurer/more/opening-balances');
    expect(await screen.findByText('Caja del comité')).toBeTruthy();
    expect(screen.getByText(/^Confirmado por el presidente/)).toBeTruthy();
    expect(screen.getByText('Espera confirmación del presidente')).toBeTruthy();
    expect(screen.getByText('Sin capturar')).toBeTruthy();

    await fireEvent.press(button('Capturar saldo'));
    // Only S2-M01 can be chosen.
    await fireEvent.press(screen.getByRole('button', { name: 'Caja: sin elegir' }));
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('radio', { name: 'Manzana S2-M01' }));
    await fireEvent.changeText(screen.getByLabelText('Importe contado, obligatorio'), '350.00');
    await fireEvent.changeText(
      screen.getByLabelText('Motivo o referencia del conteo, obligatorio'),
      'Conteo con el jefe',
    );
    await fireEvent.press(button('Enviar al presidente'));
    expect(await screen.findByText(/queda pendiente de autorizar/)).toBeTruthy();
    const [sent] = server.posts('/cashboxes/4/opening-balance');
    expect(sent?.body).toMatchObject({ amount: 35_000, reason: 'Conteo con el jefe' });
    expect(keyOf(sent)).toBe('key-1');
    expect(await screen.findAllByText('Espera confirmación del presidente')).toHaveLength(2);
  });
});

describe('G-09 · Caja (saldo y movimientos)', () => {
  it('lists the month with the date as AAAA-MM-DD, the folio and the family', async () => {
    as(LEADER);
    await open('/common/cashboxes/3');
    expect(await screen.findByText('Cobro · Familia de Ana Torres Ruiz')).toBeTruthy();
    expect(screen.getByText('2026-10-25 · PG-202610-000412')).toBeTruthy();
    // In the card (the approved opening balance) and as a movement.
    expect(screen.getAllByText('Saldo inicial')).toHaveLength(2);
    expect(screen.getByText('Mi caja · Manzana S1-M03')).toBeTruthy();
    const query = server.calls.find((call) => call.url.includes('/movements'));
    expect(new URL(query?.url ?? '').searchParams.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

describe('R-03 · Detalle de autorización', () => {
  it('an adjustment shows the handover it clarifies', async () => {
    as(PRESIDENT);
    server.state.handovers = [
      handover({ status: 'with_difference', receivedAmount: 295_000, difference: 5_000 }),
    ];
    await open('/president/approvals/61');
    expect(await screen.findByText('Faltante')).toBeTruthy();
    expect(screen.getByText('EN-202610-000031')).toBeTruthy();
    expect(screen.getByText('María López Torres')).toBeTruthy();
    expect(screen.getByText('$50.00')).toBeTruthy();
  });
});

describe('text at 140 % (M9)', () => {
  it.each([
    ['J-02', LEADER, '/block_leader/my-cashbox', 'Por confirmar'],
    ['J-03', LEADER, '/block_leader/my-cashbox/new-handover', 'Preparar entrega'],
    ['T-03', TREASURER, '/treasurer/handovers/31', 'María López Torres · Manzana S1-M03'],
    ['T-06', TREASURER, '/treasurer/cashbox/new-expense', 'Registrar gasto'],
    ['T-08', TREASURER, '/treasurer/more/plumber', '2026-10-01 al 2026-10-15'],
    ['T-12', TREASURER, '/treasurer/more/opening-balances', 'Saldos iniciales'],
  ] as const)('%s is never cut and keeps touch areas of 48', async (_id, account, url, text) => {
    as(account);
    setFontScale(1.4);
    await open(url);
    await screen.findAllByText(text);
    expect(largeTextProblems(screen.toJSON() as never)).toEqual([]);
  });
});
