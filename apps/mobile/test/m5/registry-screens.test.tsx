/// <reference types="node" />
// These tests read app/ from disk, so they use Node (the app itself never does).
import path from 'node:path';
import type { SessionAccount } from '@bella-vista/shared';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApiClient } from '../../src/api/client.js';
import { sessionStore } from '../../src/session/session-store.js';
import { apiError } from '../api/fake-api.js';
import { largeTextProblems, setFontScale } from '../ui/render.js';
import { ERNESTO, fakeM5Api, JOSE, JOSE_FULL } from './fake-m5-api.js';

// M5 · Padrón with the real app/ folder and a scripted API (3.2 §10.2, §10.4, §12): the search
// waits 400 ms, needs 2 letters and asks only for the last text; the files show what the API
// sends for the role (a block leader never sees data of another block: tested with the two
// leaders of the seed); P-02 asks "¿Es la misma persona?" with homonyms (D-10, no CURP); P-01
// filters the block roster; P-03 estimates the debt; P-04 adds a family without opening fee.

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

const leader = (block: 1 | 3): SessionAccount => ({
  username: block === 1 ? 'jm.s1m01' : 'jm.s2m01',
  role: 'block_leader',
  blockId: block,
  blockCode: block === 1 ? 'S1-M01' : 'S2-M01',
  fullName: block === 1 ? 'Laura Méndez Ruiz' : 'Josefina Ramírez Luna',
  mustChangePassword: false,
});
const officer = (role: 'secretary' | 'president'): SessionAccount => ({
  username: role === 'secretary' ? 'secretario' : 'presidente',
  role,
  blockId: null,
  blockCode: null,
  fullName: 'Silvia Montes',
  mustChangePassword: false,
});

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
  sessionStore.signedIn(leader(1));
});

const open = (url: string) => renderRouter(APP, { initialUrl: url });

describe('G-01 · Buscar', () => {
  it('waits for 2 letters and 400 ms, and asks only for the last text', async () => {
    await open('/common/search');
    const field = screen.getByLabelText('Buscar nombre, calle o folio');
    await fireEvent.changeText(field, 'J');
    expect(screen.getByText(/Escriba al menos 2 letras/)).toBeTruthy();
    // Three keystrokes within 400 ms: nothing is asked until the person stops typing.
    await fireEvent.changeText(field, 'Jo');
    await fireEvent.changeText(field, 'José');
    expect(server.gets('/search')).toHaveLength(0);
    expect(await screen.findByText('Personas')).toBeTruthy();
    const searched = server.gets('/search').map((call) => new URL(call.url).searchParams.get('q'));
    expect(searched).toEqual(['José']);
    expect(screen.getByText('José Luis Hernández García · Papá, Av. Hidalgo')).toBeTruthy();
    expect(screen.getByText('Toma T-000001 · Av. Hidalgo 12')).toBeTruthy();
    expect(screen.getByText(/Debe \$450\.00/)).toBeTruthy();
  });

  it('shows only what the API sent: a leader of another block gets the person and nothing else', async () => {
    sessionStore.signedIn(leader(3));
    server.state.search = { people: [JOSE], connections: [], units: [] };
    await open('/common/search?q=José');
    expect(await screen.findByText('José Luis Hernández García · Papá, Av. Hidalgo')).toBeTruthy();
    expect(screen.queryByText('Tomas')).toBeNull();
    expect(screen.queryByText('Familias')).toBeNull();
    expect(screen.queryByText(/Debe/)).toBeNull();
  });
});

describe('G-02 · Ficha de persona', () => {
  it('a leader sees their family with its debt, and the one of another block without data', async () => {
    await open(`/common/people/${JOSE.id}`);
    expect(await screen.findByText('José Luis Hernández García')).toBeTruthy();
    expect(screen.getByText('Folio P-000004 · Distintivo Papá, Av. Hidalgo')).toBeTruthy();
    expect(screen.getByText('5551009090')).toBeTruthy();
    expect(screen.getByText('Familia U-000001')).toBeTruthy();
    expect(screen.getByText('Debe $450.00')).toBeTruthy();
    expect(screen.getByText('Recargo')).toBeTruthy();
    expect(screen.getByText('Familia de otra manzana')).toBeTruthy();
    expect(screen.getByText('Sin acceso a sus pagos')).toBeTruthy();
  });

  it('with access "basic" (the other leader) shows only name, distinguishing note and folio', async () => {
    sessionStore.signedIn(leader(3));
    server.state.people.set(JOSE.id, { ...JOSE, access: 'basic' });
    await open(`/common/people/${JOSE.id}`);
    expect(await screen.findByText('Folio P-000004 · Distintivo Papá, Av. Hidalgo')).toBeTruthy();
    expect(screen.getByText(/no tiene familias ni solicitudes en su manzana/)).toBeTruthy();
    expect(screen.queryByText('5551009090')).toBeNull();
    expect(screen.queryByText('Familia U-000001')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar familia o toma' })).toBeNull();
  });

  it('"Agregar familia o toma" offers only what the role may do', async () => {
    const router = await open(`/common/people/${JOSE.id}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'Agregar familia o toma' }));
    expect(screen.getByRole('button', { name: 'Toma que ya existía' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Nueva solicitud de toma' }));
    expect(router.getPathname()).toBe('/common/registry/new-connection-request');
    // The person comes chosen.
    expect(await screen.findByText('José Luis Hernández García · Papá, Av. Hidalgo')).toBeTruthy();
  });

  it('the president only consults: no "Agregar familia o toma"', async () => {
    sessionStore.signedIn(officer('president'));
    await open(`/common/people/${JOSE.id}`);
    await screen.findByText('Familia U-000001');
    expect(screen.queryByRole('button', { name: 'Agregar familia o toma' })).toBeNull();
  });
});

describe('G-03 · Ficha de toma', () => {
  it('lists its families and offers "Agregar familia" while active', async () => {
    await open('/common/connections/1');
    expect(await screen.findByText('Toma T-000001')).toBeTruthy();
    expect(
      screen.getByText('U-000001 · José Luis Hernández García · Papá, Av. Hidalgo'),
    ).toBeTruthy();
    expect(screen.getByText('Casa de atrás · Debe $50.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agregar familia' })).toBeTruthy();
  });

  it('a suspended connection says it generates no fees and offers no new family', async () => {
    const connection = server.state.connections.get(1);
    if (connection) server.state.connections.set(1, { ...connection, status: 'suspended' });
    await open('/common/connections/1');
    expect(await screen.findByText(/no se generan mensualidades/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agregar familia' })).toBeNull();
  });
});

describe('P-01 · Lista del padrón', () => {
  it("shows the leader's block and filters it on the phone", async () => {
    await open('/block_leader/registry');
    expect(await screen.findByText('Manzana S1-M01 · 4 familias')).toBeTruthy();
    expect(screen.getAllByText(/^U-00000\d · /)).toHaveLength(4);

    await fireEvent.press(screen.getByRole('button', { name: 'Filtro: Con recargo' }));
    expect(screen.getAllByText(/^U-00000\d · /)).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Filtro: Con atraso' }));
    expect(screen.getAllByText(/^U-00000\d · /)).toHaveLength(2);
    await fireEvent.press(screen.getByRole('button', { name: 'Filtro: Suspendidas' }));
    expect(screen.getByText('U-000003 · Carmen Aguilar')).toBeTruthy();
    expect(screen.getAllByText(/^U-00000\d · /)).toHaveLength(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Filtro: Todos' }));
    await fireEvent.changeText(screen.getByLabelText('Buscar nombre, calle o folio'), 'morelos');
    expect(screen.getByText('U-000004 · Rafael Domínguez Flores')).toBeTruthy();
    expect(screen.getAllByText(/^U-00000\d · /)).toHaveLength(1);
    expect(server.gets('/reports/block')[0]?.url).toContain('blockId=1');
  });

  it('the secretary chooses the block', async () => {
    sessionStore.signedIn(officer('secretary'));
    await open('/secretary/registry');
    expect(await screen.findByLabelText('Manzana: S1-M01')).toBeTruthy();
  });
});

describe('P-02 · Registrar persona', () => {
  async function fillName() {
    await open('/common/registry/new-person');
    await fireEvent.changeText(await screen.findByLabelText('Nombre(s), obligatorio'), 'José Luis');
    await fireEvent.changeText(screen.getByLabelText('Apellido paterno, obligatorio'), 'Hernández');
    await fireEvent.changeText(screen.getByLabelText('Apellido materno'), 'García');
  }

  it('without homonyms registers at once and opens the new file', async () => {
    const router = await (async () => {
      const r = await open('/common/registry/new-person');
      return r;
    })();
    await fireEvent.changeText(await screen.findByLabelText('Nombre(s), obligatorio'), 'Teresa');
    await fireEvent.changeText(screen.getByLabelText('Apellido paterno, obligatorio'), 'Navarro');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(router.getPathname()).toBe('/common/people/100'));
    expect(server.posts('/people')[0]?.body).toEqual({
      givenNames: 'Teresa',
      paternalSurname: 'Navarro',
      maternalSurname: null,
      distinguishingNote: null,
      phone: null,
    });
  });

  it('with a homonym asks "¿Es la misma persona?" and, if another one, asks for the note', async () => {
    server.state.matches = { exact: [JOSE], similar: [] };
    const router = await (async () => {
      const r = await open('/common/registry/new-person');
      return r;
    })();
    await fireEvent.changeText(await screen.findByLabelText('Nombre(s), obligatorio'), 'José Luis');
    await fireEvent.changeText(screen.getByLabelText('Apellido paterno, obligatorio'), 'Hernández');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('Ya existe José Luis Hernández García. ¿Es la misma persona?'),
    ).toBeTruthy();
    expect(screen.getByText('Indique si es la misma persona.')).toBeTruthy();
    expect(server.posts('/people')).toHaveLength(0);

    await fireEvent.press(screen.getByRole('radio', { name: 'Es otra persona' }));
    // The leader's block code is proposed.
    expect(screen.getByLabelText('Distintivo, obligatorio').props.value).toBe('S1-M01');
    await fireEvent.changeText(screen.getByLabelText('Distintivo, obligatorio'), 'de la tienda');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(router.getPathname()).toBe('/common/people/100'));
    expect(server.posts('/people')[0]?.body).toMatchObject({ distinguishingNote: 'de la tienda' });
  });

  it('if it is the same person, opens their file and registers nobody', async () => {
    server.state.matches = { exact: [JOSE], similar: [] };
    await fillName();
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Es la misma persona' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Abrir su ficha' }));
    expect(await screen.findByText('Folio P-000004 · Distintivo Papá, Av. Hidalgo')).toBeTruthy();
    expect(server.posts('/people')).toHaveLength(0);
  });

  it('shows a repeated distinguishing note next to its field', async () => {
    server.state.matches = { exact: [JOSE], similar: [] };
    server.override(
      (call) => call.method === 'POST' && call.url.endsWith('/v1/people'),
      apiError(409, 'DUPLICATE_DISTINGUISHING_NOTE', 'Repetido.'),
    );
    await fillName();
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Es otra persona' }));
    await fireEvent.changeText(
      screen.getByLabelText('Distintivo, obligatorio'),
      'Papá, Av. Hidalgo',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByText(
        'Ya hay una persona con ese nombre y ese distintivo. Escriba otro distintivo.',
      ),
    ).toBeTruthy();
  });
});

describe('P-03 · Familia que ya existía', () => {
  it('estimates the debt from the first pending month and registers it', async () => {
    const router = await open(
      '/common/registry/pre-existing-connection?personId=8&personFolio=P-000008&personName=Ernesto%20V%C3%A1zquez%20Soto',
    );
    await fireEvent.changeText(
      await screen.findByLabelText('Dirección de la toma, obligatorio'),
      'Calle Pino 12',
    );
    // The leader's block is fixed; the holder came from G-02.
    expect(screen.getByText('S1-M01')).toBeTruthy();
    expect(screen.getByText('Ernesto Vázquez Soto')).toBeTruthy();
    expect(screen.getByText('Primer mes pendiente según la libreta *')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Primer mes pendiente según la libreta: /));
    const options = await screen.findAllByRole('radio');
    // Newest first: the third option is two months before this one.
    const third = options[2];
    if (third) await fireEvent.press(third);
    expect(await screen.findByText(/^Estimación: Debería /)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Guardar familia' }));
    await waitFor(() => expect(router.getPathname()).toBe('/common/connections/100'));
    expect(server.posts('/connections/pre-existing')[0]?.body).toMatchObject({
      address: 'Calle Pino 12',
      blockId: 1,
      unit: {
        holderPersonId: ERNESTO.id,
        billingStartPeriod: expect.stringMatching(/^\d{4}-\d{2}$/),
      },
    });
  });
});

describe('P-04 · Agregar familia', () => {
  it('adds a family without opening fee, from its activation month', async () => {
    const router = await open('/common/connections/1');
    await fireEvent.press(await screen.findByRole('button', { name: 'Agregar familia' }));
    expect(router.getPathname()).toBe('/common/connections/1/add-unit');
    expect(await screen.findByText('Toma T-000001 · Av. Hidalgo 12')).toBeTruthy();
    expect(screen.getByText(/^No se cobra apertura\. Pagará completo /)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Buscar por nombre o folio'), 'José');
    await fireEvent.press(
      await screen.findByText(
        'José Luis Hernández García · Papá, Av. Hidalgo',
        {},
        { timeout: 2000 },
      ),
    );
    await fireEvent.changeText(screen.getByLabelText('Referencia'), 'Cuarto de la azotea');
    await fireEvent.press(screen.getByRole('button', { name: 'Agregar familia' }));
    await waitFor(() => expect(server.posts('/units')).toHaveLength(1));
    expect(server.posts('/units')[0]?.body).toMatchObject({
      connectionId: 1,
      holderPersonId: JOSE.id,
      reference: 'Cuarto de la azotea',
    });
    // Back to G-03, without asking "¿Salir sin enviar?" (it was saved).
    await waitFor(() => expect(router.getPathname()).toBe('/common/connections/1'));
    expect(screen.queryByText('¿Salir sin enviar?')).toBeNull();
  });
});

describe('text at 140 %', () => {
  it.each([
    ['G-02', `/common/people/${JOSE.id}`, 'Familia U-000001'],
    ['G-03', '/common/connections/1', 'Familias conectadas'],
    ['P-01', '/block_leader/registry', 'Manzana S1-M01 · 4 familias'],
    ['P-02', '/common/registry/new-person', 'Registrar persona'],
  ])('%s is never cut', async (_id, url, text) => {
    setFontScale(1.4);
    await open(url);
    await screen.findAllByText(text);
    expect(largeTextProblems(screen.toJSON() as never)).toEqual([]);
  });
});

// Keep the full file in the fixture honest.
test('the fixture person has a family of another block', () => {
  expect(
    JOSE_FULL.access === 'full' && JOSE_FULL.units.some((u) => u.scope === 'other_block'),
  ).toBe(true);
});
