import { act, fireEvent, screen } from '@testing-library/react-native';
import { DeviceEventEmitter, Platform, StyleSheet } from 'react-native';
import { AppText, BottomSheet, TextField } from '../../src/ui/index.js';
import { renderUi } from './render.js';

// The bottom sheet over the keyboard: a Modal is not resized by Android (edge to edge), so the
// sheet itself rises by the part of the keyboard that covers its window.

const WINDOW = 800;
const KEYBOARD = 300;
const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

async function renderSheet() {
  await renderUi(
    <BottomSheet visible title="Registrar fontanero" onClose={() => undefined}>
      <TextField label="Nombre" value="" onChangeText={() => undefined} />
      <AppText>Contenido</AppText>
    </BottomSheet>,
  );
  const root = screen.getByTestId('bottom-sheet-window');
  await fireEvent(root, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: WINDOW } },
  });
}

const marginBottom = () =>
  StyleSheet.flatten(screen.getByTestId('bottom-sheet-area').props.style).marginBottom;

const keyboard = async (event: string, screenY: number) =>
  await act(() => {
    DeviceEventEmitter.emit(event, {
      endCoordinates: { screenX: 0, screenY, width: 400, height: WINDOW - screenY },
    });
  });

describe('BottomSheet and the keyboard', () => {
  it('rises above the keyboard and comes back down when it hides', async () => {
    await renderSheet();
    expect(marginBottom()).toBe(0);
    await keyboard(showEvent, WINDOW - KEYBOARD);
    expect(marginBottom()).toBe(KEYBOARD);
    await keyboard(hideEvent, WINDOW);
    expect(marginBottom()).toBe(0);
  });

  it('does not rise twice when the system already resized the window', async () => {
    await renderSheet();
    await keyboard(showEvent, WINDOW - KEYBOARD);
    await fireEvent(screen.getByTestId('bottom-sheet-window'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: WINDOW - KEYBOARD } },
    });
    expect(marginBottom()).toBe(0);
  });
});
