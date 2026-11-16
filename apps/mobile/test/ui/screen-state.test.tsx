import { screen } from '@testing-library/react-native';
import { ApiError } from '../../src/api/errors.js';
import { AppText } from '../../src/ui/AppText.js';
import { type QueryLike, ScreenState, screenStatusOf } from '../../src/ui/ScreenState.js';
import { renderUi } from './render.js';

// Envoltura de estados (3.2 §11.1): one mapping from a query to the five states.

const query = (overrides: Partial<QueryLike<number[]>>): QueryLike<number[]> => ({
  status: 'success',
  fetchStatus: 'idle',
  error: null,
  data: [1],
  ...overrides,
});

describe('screenStatusOf', () => {
  it.each<[string, Partial<QueryLike<number[]>>, string]>([
    ['first load', { status: 'pending', fetchStatus: 'fetching', data: undefined }, 'loading'],
    [
      'first load without network',
      { status: 'pending', fetchStatus: 'paused', data: undefined },
      'offline',
    ],
    ['no permission', { status: 'error', error: new ApiError('FORBIDDEN', 403, '') }, 'forbidden'],
    ['other block', { status: 'error', error: new ApiError('OUT_OF_SCOPE', 403, '') }, 'forbidden'],
    [
      'network failure',
      { status: 'error', error: new ApiError('NETWORK_ERROR', 0, '') },
      'offline',
    ],
    ['server error', { status: 'error', error: new ApiError('INTERNAL_ERROR', 500, '') }, 'error'],
    ['empty list', { data: [] }, 'empty'],
    ['data', {}, 'ready'],
    ['reloading keeps the data', { fetchStatus: 'fetching' }, 'ready'],
  ])('%s → %s', (_name, overrides, expected) => {
    expect(screenStatusOf(query(overrides), (data) => data.length === 0)).toBe(expected);
  });
});

describe('ScreenState', () => {
  it('an error shows its Spanish message and "Reintentar"', async () => {
    await renderUi(
      <ScreenState
        status="error"
        error={new ApiError('INTERNAL_ERROR', 500, '')}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText('Ocurrió un error inesperado. Intente de nuevo.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('no permission never shows the content', async () => {
    await renderUi(
      <ScreenState status="forbidden">
        <AppText>Dato privado</AppText>
      </ScreenState>,
    );
    expect(screen.getByText('No tiene permiso para esta acción.')).toBeTruthy();
    expect(screen.queryByText('Dato privado')).toBeNull();
  });

  it('a session that ended does not offer "Reintentar"', async () => {
    await renderUi(
      <ScreenState
        status="error"
        error={new ApiError('UNAUTHENTICATED', 401, '')}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText('Su sesión terminó, inicie sesión de nuevo.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });
});
