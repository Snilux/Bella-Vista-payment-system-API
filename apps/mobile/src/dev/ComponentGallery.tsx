import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../api/errors.js';
import {
  AmountField,
  AppText,
  BottomSheet,
  Button,
  Checkbox,
  Chip,
  ConfirmSheet,
  colors,
  DataRow,
  type FetchPage,
  Header,
  ICONS,
  Icon,
  type IconName,
  ListRow,
  layout,
  MenuRow,
  MonthRow,
  Notice,
  PaginatedList,
  Radio,
  RecordCard,
  radii,
  ScreenState,
  type ScreenStatus,
  SearchField,
  Select,
  StatusTag,
  type StatusTone,
  SuccessScreen,
  spacing,
  statusColors,
  TabBar,
  TextField,
  typography,
} from '../ui/index.js';

// Component gallery (3.2 M1): every design-system component with its variants, in the order of
// the Figma "Componentes" page, to compare with docs/diseno/componentes/. Development only.
// Fixtures only; nothing here calls the API.

const TONES: StatusTone[] = ['paid', 'pending', 'overdue', 'surcharge', 'advance', 'cancelled'];

const BASE_COLORS = {
  primary: colors.primary,
  primaryStrong: colors.primaryStrong,
  primarySoft: colors.primarySoft,
  background: colors.background,
  surface: colors.surface,
  surfaceWarm: colors.surfaceWarm,
  text: colors.text,
  textSecondary: colors.textSecondary,
  borderStrong: colors.borderStrong,
  divider: colors.divider,
  error: colors.error,
} as const;

export function ComponentGallery() {
  const [screen, setScreen] = useState<'gallery' | 'list'>('gallery');
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {screen === 'gallery' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Header
            title="Galería de componentes"
            subtitle="Solo en desarrollo · compárela con Figma"
            onBack={() => router.back()}
          />
          <Foundations />
          <Buttons />
          <Fields />
          <Selection />
          <Rows />
          <Navigation />
          <Feedback />
          <Section title="Lista paginada">
            <Button
              label="Abrir lista de ejemplo"
              variant="secondary"
              onPress={() => setScreen('list')}
            />
          </Section>
        </ScrollView>
      ) : (
        <PaginatedDemo onBack={() => setScreen('gallery')} />
      )}
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Foundations() {
  return (
    <>
      <Section title="Colores">
        <View style={styles.swatches}>
          {Object.entries(BASE_COLORS).map(([name, value]) => (
            <Swatch key={name} name={name} value={value} />
          ))}
        </View>
        <View style={styles.wrap}>
          {TONES.map((tone) => (
            <Swatch key={tone} name={tone} value={statusColors[tone].background} />
          ))}
        </View>
      </Section>
      <Section title="Tipografía">
        {(Object.keys(typography) as (keyof typeof typography)[]).map((variant) => (
          <AppText key={variant} variant={variant}>
            {`${variant} · ${typography[variant].fontSize}/${typography[variant].lineHeight}`}
          </AppText>
        ))}
        <AppText variant="display" amount>
          $3,450.00
        </AppText>
      </Section>
      <Section title="Iconos">
        <View style={styles.wrap}>
          {(Object.keys(ICONS) as IconName[]).map((name) => (
            <View key={name} style={styles.icon}>
              <Icon name={name} />
              <AppText variant="caption" color={colors.textSecondary}>
                {name}
              </AppText>
            </View>
          ))}
        </View>
      </Section>
    </>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <View style={styles.swatch}>
      <View style={[styles.swatchColor, { backgroundColor: value }]} />
      <AppText variant="caption">{name}</AppText>
      <AppText variant="caption" color={colors.textSecondary}>
        {value}
      </AppText>
    </View>
  );
}

function Buttons() {
  const [saving, setSaving] = useState(false);
  const noop = () => undefined;
  return (
    <Section title="Botón">
      <Button label="Registrar pago" onPress={noop} />
      <Button label="Registrar pago" onPress={noop} disabledReason="Elija al menos un mes." />
      <Button label="Registrar pago" variant="secondary" onPress={noop} />
      <Button
        label="Registrar pago"
        variant="secondary"
        onPress={noop}
        disabledReason="Falta el folio del recibo."
      />
      <Button label="Registrar pago" variant="text" onPress={noop} />
      <Button
        label="Registrar pago"
        variant="text"
        onPress={noop}
        disabledReason="No disponible."
      />
      <Button label="Registrar pago" variant="danger" onPress={noop} />
      <Button
        label="Registrar pago"
        variant="danger"
        onPress={noop}
        disabledReason="Escriba el motivo."
      />
      <Button
        label={saving ? 'Registrar pago' : 'Probar "Guardando..." (toque)'}
        loading={saving}
        onPress={() => {
          setSaving(true);
          setTimeout(() => setSaving(false), 2000);
        }}
      />
    </Section>
  );
}

function Fields() {
  const [folio, setFolio] = useState('001234');
  const [password, setPassword] = useState('secreta123');
  const [amount, setAmount] = useState<number | null>(300_000);
  const [search, setSearch] = useState('');
  return (
    <Section title="Campo">
      <TextField
        label="Folio del recibo de papel"
        required
        value={folio}
        onChangeText={setFolio}
        keyboardType="number-pad"
        help="Escríbalo como aparece en el talonario."
      />
      <TextField
        label="Folio del recibo de papel"
        required
        value="001234"
        error="Este folio ya se usó en su talonario."
      />
      <TextField label="Contraseña" required password value={password} onChangeText={setPassword} />
      <AmountField
        label="Importe a entregar"
        required
        valueCents={amount}
        onChangeCents={setAmount}
        help={amount === null ? 'Sin importe válido.' : `Centavos: ${amount}`}
      />
      <AppText variant="label">Buscador</AppText>
      <SearchField value={search} onChangeText={setSearch} />
    </Section>
  );
}

function Selection() {
  const [category, setCategory] = useState<string | null>('repairs');
  const [samePerson, setSamePerson] = useState<boolean | null>(false);
  const [paid, setPaid] = useState(false);
  const [filters, setFilters] = useState<Record<string, boolean>>({ late: true });
  return (
    <>
      <Section title="Selector">
        <Select
          label="Categoría"
          required
          value={category}
          onChange={setCategory}
          options={[
            { value: 'repairs', label: 'Reparaciones' },
            { value: 'materials', label: 'Materiales' },
            { value: 'plumber', label: 'Fontanero', description: 'Pago de salario' },
          ]}
        />
        <Select
          label="Acuerdo de junta"
          required
          value={null}
          onChange={() => undefined}
          options={[]}
          error="Elija el acuerdo."
        />
      </Section>
      <Section title="Opción">
        <Radio
          label="Es la misma persona"
          selected={samePerson === true}
          onPress={() => setSamePerson(true)}
        />
        <Radio
          label="Es otra persona"
          selected={samePerson === false}
          onPress={() => setSamePerson(false)}
        />
      </Section>
      <Section title="Casilla">
        <Checkbox label="Ya se pagó" checked={paid} onChange={setPaid} />
      </Section>
      <Section title="Chip">
        <View style={styles.wrap}>
          {[
            ['late', 'Con atraso'],
            ['surcharge', 'Con recargo'],
            ['suspended', 'Suspendidas'],
          ].map(([key = '', label = '']) => (
            <Chip
              key={key}
              label={label}
              selected={filters[key] === true}
              onPress={() => setFilters((current) => ({ ...current, [key]: !current[key] }))}
            />
          ))}
        </View>
      </Section>
    </>
  );
}

function Rows() {
  const [checked, setChecked] = useState<Record<string, boolean>>({ '2026-06': true });
  const toggle = (period: string) => () =>
    setChecked((current) => ({ ...current, [period]: !current[period] }));
  return (
    <>
      <Section title="Etiqueta de estado">
        <View style={styles.wrap}>
          {TONES.map((tone) => (
            <StatusTag key={tone} tone={tone} />
          ))}
        </View>
      </Section>
      <Section title="Fila de mes">
        <MonthRow
          period="2026-06"
          tone="surcharge"
          baseCents={5_000}
          surchargeCents={5_000}
          totalCents={10_000}
          checked={checked['2026-06'] === true}
          onToggle={toggle('2026-06')}
        />
        <MonthRow
          period="2026-07"
          tone="surcharge"
          baseCents={5_000}
          surchargeCents={5_000}
          totalCents={10_000}
          checked={checked['2026-07'] === true}
          onToggle={toggle('2026-07')}
        />
        <MonthRow
          period="2026-10"
          tone="pending"
          baseCents={5_000}
          surchargeCents={0}
          totalCents={5_000}
          checked={checked['2026-10'] === true}
          onToggle={toggle('2026-10')}
        />
        <MonthRow
          period="2026-11"
          tone="advance"
          baseCents={5_000}
          surchargeCents={0}
          totalCents={5_000}
          checked={false}
          onToggle={() => undefined}
          disabled
        />
      </Section>
      <Section title="Fila de menú">
        <View>
          <MenuRow icon="people" label="Familias con recargo" count={7} onPress={() => undefined} />
          <MenuRow icon="people" label="Familias con atraso" count={12} onPress={() => undefined} />
          <MenuRow
            icon="closing"
            label="Corte de octubre por hacer"
            onPress={() => undefined}
            active
          />
        </View>
      </Section>
      <Section title="Fila de lista">
        <View>
          <ListRow
            title="Octubre 2026"
            subtitle="Recibo 001234"
            tag={{ tone: 'pending' }}
            amountCents={5_000}
          />
          <ListRow title="25 oct · Pago PG-000981" amountCents={20_000} onPress={() => undefined} />
          <ListRow title="Mayo 2026" tag={{ tone: 'paid' }} amountCents={5_000} />
        </View>
      </Section>
      <Section title="Tarjeta de registro">
        <RecordCard
          title="Juan Pérez López"
          details={['Calle Pino 12 · Toma T-0123']}
          summary="Debe $400.00"
          tag={{ tone: 'surcharge' }}
          onPress={() => undefined}
        />
        <RecordCard
          title="Juan Pérez López · la tienda"
          details={['Calle Roble 3 · Toma T-0201']}
          summary="Al corriente"
          tag={{ tone: 'paid' }}
          onPress={() => undefined}
        />
      </Section>
      <Section title="Dato">
        <View style={[styles.card, styles.sectionBody]}>
          <DataRow label="Titular" value="Juan Pérez López" />
          <DataRow label="Familia" value="U-0045 · T-0123" />
          <DataRow label="Meses" value="Junio, julio, agosto y septiembre 2026" />
          <DataRow label="Total" value="$200.00" amount />
        </View>
      </Section>
    </>
  );
}

function Navigation() {
  const [tab, setTab] = useState('home');
  return (
    <>
      <Section title="Encabezado">
        <Header
          title="Registrar pago"
          subtitle="Juan Pérez López · Familia U-0045"
          onBack={() => undefined}
          step={{ current: 1, total: 4 }}
        />
      </Section>
      <Section title="Barra de pestañas">
        <TabBar
          activeKey={tab}
          onSelect={setTab}
          items={[
            { key: 'home', label: 'Inicio', icon: 'home' },
            { key: 'charge', label: 'Cobrar', icon: 'cash' },
            { key: 'registry', label: 'Padrón', icon: 'people' },
            { key: 'cashbox', label: 'Mi caja', icon: 'wallet', badge: 1 },
            { key: 'more', label: 'Más', icon: 'menu' },
          ]}
        />
      </Section>
    </>
  );
}

function Feedback() {
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);
  const [status, setStatus] = useState<ScreenStatus>('loading');
  const states: ScreenStatus[] = ['loading', 'empty', 'error', 'offline', 'forbidden'];
  return (
    <>
      <Section title="Aviso">
        <Notice title="Tiene 4 meses vencidos." detail="Cada mes vencido paga doble." />
        <Notice icon="offline" title="Sin conexión" />
      </Section>
      <Section title="Hoja inferior">
        <Button label="Abrir hoja inferior" variant="secondary" onPress={() => setSheet(true)} />
        <Button
          label="Abrir hoja de confirmación"
          variant="secondary"
          onPress={() => setConfirm(true)}
        />
        <BottomSheet visible={sheet} onClose={() => setSheet(false)} title="Periodo">
          <AppText variant="body">Contenido de la hoja: opciones en filas de 56.</AppText>
        </BottomSheet>
        <ConfirmSheet
          visible={confirm}
          title="¿Registrar el pago?"
          loading={confirming}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirming(true);
            setTimeout(() => {
              setConfirming(false);
              setConfirm(false);
            }, 1500);
          }}
        >
          <DataRow label="Titular" value="Juan Pérez López" />
          <DataRow label="Total" value="$200.00" amount />
        </ConfirmSheet>
      </Section>
      <Section title="Pantalla de éxito">
        <Button
          label="Abrir pantalla de éxito"
          variant="secondary"
          onPress={() => setSuccess(true)}
        />
        <Modal visible={success} animationType="slide" onRequestClose={() => setSuccess(false)}>
          <SafeAreaView style={styles.safe}>
            <SuccessScreen
              title="Pago registrado"
              message="Copie estos datos en el recibo:"
              onDone={() => setSuccess(false)}
              secondary={{ label: 'Cobrar a otra familia', onPress: () => setSuccess(false) }}
            >
              <DataRow label="Titular" value="Juan Pérez López" />
              <DataRow label="Meses" value="Junio y julio 2026" />
              <DataRow label="Total" value="$200.00" amount />
              <DataRow label="Recibo" value="001234" />
              <DataRow label="Registro" value="PG-000981" />
            </SuccessScreen>
          </SafeAreaView>
        </Modal>
      </Section>
      <Section title="Estados de pantalla">
        <View style={styles.wrap}>
          {states.map((value) => (
            <Chip
              key={value}
              label={value}
              selected={status === value}
              onPress={() => setStatus(value)}
            />
          ))}
        </View>
        <View style={styles.card}>
          <ScreenState
            status={status}
            error={new ApiError('INTERNAL_ERROR', 500, '')}
            onRetry={() => undefined}
            empty={{
              message: 'No hay entregas por confirmar.',
              icon: 'handover',
              action: { label: 'Actualizar', onPress: () => undefined },
            }}
          />
        </View>
      </Section>
    </>
  );
}

type DemoItem = { id: number; name: string; debtCents: number };

/** 45 fake families, 20 per page, with a short delay to see "Cargando más...". */
const fetchDemoPage: FetchPage<DemoItem> = async ({ limit, cursor }) => {
  await new Promise((resolve) => setTimeout(resolve, 600));
  const start = cursor ? Number(cursor) : 0;
  const total = 45;
  const data = Array.from({ length: Math.min(limit, total - start) }, (_, index) => ({
    id: start + index + 1,
    name: `Familia U-${String(start + index + 1).padStart(4, '0')}`,
    debtCents: ((start + index) % 5) * 5_000,
  }));
  const next = start + limit < total ? String(start + limit) : null;
  return { data, next };
};

function PaginatedDemo({ onBack }: { onBack: () => void }) {
  return (
    <PaginatedList
      queryKey={['dev', 'gallery', 'families']}
      fetchPage={fetchDemoPage}
      keyExtractor={(item) => String(item.id)}
      renderItem={(item) => (
        <ListRow
          title={item.name}
          tag={
            item.debtCents > 0
              ? { tone: 'overdue', label: 'Con atraso' }
              : { tone: 'paid', label: 'Al corriente' }
          }
          amountCents={item.debtCents}
        />
      )}
      empty={{ message: 'No hay familias.' }}
      header={
        <Header
          title="Lista paginada"
          subtitle="45 familias de ejemplo, 20 por página"
          onBack={onBack}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: layout.screenMargin, gap: spacing.xxl, paddingBottom: spacing.xxxl },
  section: { gap: spacing.md },
  sectionBody: { gap: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  swatch: { width: 104, gap: 2 },
  swatchColor: {
    height: 48,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  icon: { width: 96, alignItems: 'center', gap: spacing.xs },
  card: {
    padding: layout.cardPadding,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.divider,
  },
});
