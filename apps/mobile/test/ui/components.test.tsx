import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import {
  AmountField,
  Button,
  Checkbox,
  Chip,
  ConfirmSheet,
  DataRow,
  Header,
  INVALID_AMOUNT_MESSAGE,
  ListRow,
  MenuRow,
  MonthRow,
  Notice,
  Radio,
  RecordCard,
  ScreenState,
  SearchField,
  Select,
  StatusTag,
  SuccessScreen,
  TabBar,
  TextField,
} from '../../src/ui/index.js';
import { largeTextProblems, renderUi, setFontScale } from './render.js';

// Components of M1 (3.2 §6 and §12): readable at 140 % and the behavior each one promises.

const noop = () => undefined;

const SAMPLES: [string, ReactElement][] = [
  [
    'Button',
    <Button key="b" label="Registrar pago" onPress={noop} disabledReason="Elija un mes." />,
  ],
  ['Button (text)', <Button key="bt" label="Ver detalle" variant="text" onPress={noop} />],
  [
    'TextField',
    <TextField
      key="tf"
      label="Folio del recibo de papel"
      required
      value="001234"
      help="Escríbalo como aparece en el talonario."
      error="Este folio ya se usó en su talonario."
    />,
  ],
  ['TextField (password)', <TextField key="pw" label="Contraseña" password value="x" />],
  [
    'Select',
    <Select
      key="s"
      label="Categoría"
      value="a"
      onChange={noop}
      options={[{ value: 'a', label: 'Reparaciones' }]}
    />,
  ],
  ['Radio', <Radio key="r" label="Es otra persona" selected onPress={noop} />],
  ['Checkbox', <Checkbox key="c" label="Ya se pagó" checked={false} onChange={noop} />],
  ['StatusTag', <StatusTag key="st" tone="surcharge" />],
  [
    'MonthRow',
    <MonthRow
      key="m"
      period="2026-06"
      tone="surcharge"
      baseCents={5_000}
      surchargeCents={5_000}
      totalCents={10_000}
      checked
      onToggle={noop}
    />,
  ],
  [
    'MenuRow',
    <MenuRow key="mr" icon="people" label="Familias con recargo" count={7} onPress={noop} />,
  ],
  [
    'ListRow',
    <ListRow
      key="lr"
      title="Octubre 2026"
      subtitle="Recibo 001234"
      tag={{ tone: 'pending' }}
      amountCents={5_000}
    />,
  ],
  [
    'RecordCard',
    <RecordCard
      key="rc"
      title="Juan Pérez López"
      details={['Calle Pino 12 · Toma T-0123']}
      summary="Debe $400.00"
      tag={{ tone: 'surcharge' }}
      onPress={noop}
    />,
  ],
  [
    'Header',
    <Header
      key="h"
      title="Registrar pago"
      subtitle="Familia U-0045"
      onBack={noop}
      step={{ current: 1, total: 4 }}
    />,
  ],
  [
    'TabBar',
    <TabBar
      key="tb"
      activeKey="home"
      onSelect={noop}
      items={[
        { key: 'home', label: 'Inicio', icon: 'home' },
        { key: 'more', label: 'Más', icon: 'menu', badge: 2 },
      ]}
    />,
  ],
  ['Chip', <Chip key="ch" label="Con atraso" selected onPress={noop} />],
  ['SearchField', <SearchField key="sf" value="Pérez" onChangeText={noop} />],
  [
    'Notice',
    <Notice key="n" title="Tiene 4 meses vencidos." detail="Cada mes vencido paga doble." />,
  ],
  [
    'ConfirmSheet',
    <ConfirmSheet key="cs" visible title="¿Registrar el pago?" onConfirm={noop} onCancel={noop}>
      <DataRow label="Total" value="$200.00" amount />
    </ConfirmSheet>,
  ],
  [
    'SuccessScreen',
    <SuccessScreen key="ss" title="Pago registrado" message="Copie estos datos:" onDone={noop}>
      <DataRow label="Registro" value="PG-000981" />
    </SuccessScreen>,
  ],
  ['DataRow', <DataRow key="d" label="Titular" value="Juan Pérez López" />],
  [
    'AmountField',
    <AmountField key="a" label="Importe" valueCents={300_000} onChangeCents={noop} />,
  ],
  ['ScreenState (error)', <ScreenState key="e" status="error" error={null} onRetry={noop} />],
  [
    'ScreenState (empty)',
    <ScreenState
      key="em"
      status="empty"
      empty={{ message: 'No hay entregas.', action: { label: 'Actualizar', onPress: noop } }}
    />,
  ],
];

describe('text at 140 %', () => {
  beforeAll(() => setFontScale(1.4));
  afterAll(() => setFontScale(1));

  it.each(SAMPLES)(
    '%s scales, never cuts text and keeps 48-point touch areas',
    async (_name, element) => {
      await renderUi(element);
      expect(largeTextProblems(screen.toJSON())).toEqual([]);
    },
  );
});

describe('Button', () => {
  it('while saving says "Guardando..." and ignores presses', async () => {
    const onPress = jest.fn();
    await renderUi(<Button label="Registrar pago" onPress={onPress} loading />);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardando...' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('a disabled button says why and ignores presses', async () => {
    const onPress = jest.fn();
    await renderUi(
      <Button label="Continuar" onPress={onPress} disabledReason="Elija al menos un mes." />,
    );
    expect(screen.getByText('Elija al menos un mes.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('selection', () => {
  it('the whole checkbox row toggles it', async () => {
    const onChange = jest.fn();
    await renderUi(<Checkbox label="Ya se pagó" checked={false} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Ya se pagó' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('a disabled month cannot be checked', async () => {
    const onToggle = jest.fn();
    await renderUi(
      <MonthRow
        period="2026-12"
        tone="advance"
        baseCents={5_000}
        surchargeCents={0}
        totalCents={5_000}
        checked={false}
        onToggle={onToggle}
        disabled
      />,
    );
    await fireEvent.press(screen.getByRole('checkbox'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('a month shows its name, breakdown and total in es-MX', async () => {
    await renderUi(
      <MonthRow
        period="2026-06"
        tone="surcharge"
        baseCents={5_000}
        surchargeCents={5_000}
        totalCents={10_000}
        checked={false}
        onToggle={noop}
      />,
    );
    expect(screen.getByText('Junio 2026')).toBeTruthy();
    expect(screen.getByText('$50.00 + recargo $50.00')).toBeTruthy();
    expect(screen.getByText('$100.00')).toBeTruthy();
    expect(screen.getByText('Recargo')).toBeTruthy();
  });

  it('the selector opens a sheet and returns the chosen value', async () => {
    const onChange = jest.fn();
    await renderUi(
      <Select
        label="Categoría"
        value={null}
        onChange={onChange}
        options={[
          { value: 'repairs', label: 'Reparaciones' },
          { value: 'materials', label: 'Materiales' },
        ]}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Categoría: sin elegir' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Materiales' }));
    expect(onChange).toHaveBeenCalledWith('materials');
  });
});

describe('DataRow', () => {
  const direction = () =>
    StyleSheet.flatten(screen.getByTestId('data-row').props.style as never as object) as {
      flexDirection?: string;
    };

  it('label and value side by side when they fit', async () => {
    await renderUi(<DataRow label="Titular" value="Juan Pérez López" />);
    expect(direction().flexDirection).toBe('row');
  });

  it('stacks when the value wraps (long value or text at 140 %)', async () => {
    await renderUi(<DataRow label="Meses" value="Junio, julio, agosto y septiembre 2026" />);
    await fireEvent(screen.getByText('Junio, julio, agosto y septiembre 2026'), 'textLayout', {
      nativeEvent: { lines: [{ text: 'Junio, julio,' }, { text: 'agosto y septiembre 2026' }] },
    });
    expect(direction().flexDirection).toBe('column');
  });
});

describe('AmountField', () => {
  it('hands back whole cents and adds commas when leaving the field', async () => {
    const onChangeCents = jest.fn();
    await renderUi(<AmountField label="Importe" valueCents={null} onChangeCents={onChangeCents} />);
    const input = screen.getByLabelText('Importe');
    await fireEvent.changeText(input, '1250.5');
    expect(onChangeCents).toHaveBeenLastCalledWith(125_050);
    await fireEvent(input, 'blur');
    expect(screen.getByDisplayValue('1,250.50')).toBeTruthy();
  });

  it('says when the amount is not valid', async () => {
    const onChangeCents = jest.fn();
    await renderUi(<AmountField label="Importe" valueCents={null} onChangeCents={onChangeCents} />);
    const input = screen.getByLabelText('Importe');
    await fireEvent.changeText(input, '12,34');
    await fireEvent(input, 'blur');
    expect(onChangeCents).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(INVALID_AMOUNT_MESSAGE)).toBeTruthy();
  });
});

describe('TextField', () => {
  it('the password button shows and hides it', async () => {
    await renderUi(<TextField label="Contraseña" password value="secreta" />);
    expect(screen.getByLabelText('Contraseña').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(screen.getByLabelText('Contraseña').props.secureTextEntry).toBe(false);
  });

  it('marks required fields with "*" and shows the error instead of the help', async () => {
    await renderUi(
      <TextField label="Folio" required help="Ayuda" error="Escriba el folio." value="" />,
    );
    expect(screen.getByText('Folio *')).toBeTruthy();
    expect(screen.getByText('Escriba el folio.')).toBeTruthy();
    expect(screen.queryByText('Ayuda')).toBeNull();
  });
});

describe('the 140 % check itself', () => {
  it('catches cut text, a fixed height around text and a small touch area', async () => {
    const { Pressable, Text, View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    const font = { fontFamily: 'Inter_400Regular' };
    await renderUi(
      <View style={{ height: 40 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={font}>
          Texto cortado
        </Text>
        <Pressable accessibilityRole="button" style={{ minHeight: 32 }} onPress={noop}>
          <Text style={font}>Chico</Text>
        </Pressable>
      </View>,
    );
    expect(largeTextProblems(screen.toJSON())).toEqual([
      expect.stringContaining('fixed height 40'),
      expect.stringContaining('numberOfLines'),
      expect.stringContaining('touch area under 48 (32)'),
      expect.stringContaining('maxFontSizeMultiplier'),
    ]);
  });
});
