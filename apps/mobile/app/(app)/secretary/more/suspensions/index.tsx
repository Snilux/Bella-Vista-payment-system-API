// S-08 · Suspensiones
import type { SuspensionListItem } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { describeError } from '../../../../../src/api/error-messages.js';
import { suspensionPages, useEndSuspension } from '../../../../../src/api/useSuspensions.js';
import {
  reactivationOptions,
  SUSPENSION_EFFECT,
  suspensionCard,
} from '../../../../../src/features/registry/registry-view.js';
import { useCan } from '../../../../../src/session/permissions.js';
import {
  AppText,
  BottomSheet,
  Button,
  Chip,
  colors,
  Header,
  Notice,
  PaginatedList,
  RecordCard,
  ScreenLayout,
  Select,
  spacing,
} from '../../../../../src/ui/index.js';

// The suspended connections and families (Figma S-08; 3.2 §10.7; D-06), from GET /v1/suspensions
// (committee). An active one opens "Reactivar": the person chooses "Se vuelve a cobrar desde"
// this month or the next one, and the app sends the month before as the last one without billing
// (approved difference, 3.2 §6 M5). "Suspender toma o familia" opens the form.

type Status = 'active' | 'ended';

export default function Suspensions() {
  const canManage = useCan('suspensions.manage');
  const [status, setStatus] = useState<Status>('active');
  const [open, setOpen] = useState<SuspensionListItem | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pages = suspensionPages(status);

  return (
    <ScreenLayout
      scroll={false}
      {...(canManage
        ? {
            footer: (
              <Button
                label="Suspender toma o familia"
                onPress={() => router.push('/secretary/more/suspensions/new')}
              />
            ),
          }
        : {})}
    >
      <PaginatedList
        key={status}
        queryKey={pages.queryKey}
        fetchPage={pages.fetchPage}
        keyExtractor={(item) => String(item.id)}
        renderItem={(item) => {
          const card = suspensionCard(item);
          return (
            <View style={styles.item}>
              <RecordCard
                title={card.title}
                details={card.details}
                summary={card.summary}
                {...(status === 'active' && canManage
                  ? { onPress: () => setOpen(item), accessibilityHint: 'Abre Reactivar' }
                  : {})}
              />
            </View>
          );
        }}
        empty={{
          message:
            status === 'active'
              ? 'No hay tomas ni familias suspendidas.'
              : 'Todavía no hay suspensiones terminadas.',
          icon: 'suspension',
        }}
        header={
          <View style={styles.header}>
            <Header
              title="Suspensiones"
              subtitle={status === 'active' ? 'Vigentes' : 'Terminadas'}
              onBack={() => router.back()}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              <Chip
                label="Vigentes"
                selected={status === 'active'}
                onPress={() => setStatus('active')}
              />
              <Chip
                label="Terminadas"
                selected={status === 'ended'}
                onPress={() => setStatus('ended')}
              />
            </ScrollView>
            {done ? <Notice icon="success" title={done} /> : null}
            <AppText variant="caption" color={colors.textSecondary}>
              {SUSPENSION_EFFECT}
            </AppText>
          </View>
        }
      />

      {open ? (
        <ReactivateSheet
          item={open}
          onClose={() => setOpen(null)}
          onDone={(message) => {
            setOpen(null);
            setDone(message);
          }}
        />
      ) : null}
    </ScreenLayout>
  );
}

function ReactivateSheet({
  item,
  onClose,
  onDone,
}: {
  item: SuspensionListItem;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const end = useEndSuspension();
  const options = reactivationOptions(item.periodFrom);
  const [billFrom, setBillFrom] = useState(options[0]?.value ?? null);
  const chosen = options.find((option) => option.value === billFrom) ?? null;
  const card = suspensionCard(item);

  return (
    <BottomSheet
      visible
      title="Reactivar"
      onClose={end.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button
            label="Reactivar"
            loading={end.isPending}
            disabledReason={chosen ? null : 'Esta suspensión todavía no empieza.'}
            onPress={() =>
              chosen &&
              end.mutate(
                { id: item.id, periodTo: chosen.periodTo },
                {
                  onSuccess: () =>
                    onDone(
                      `${card.title}: se vuelve a cobrar desde ${chosen.label.toLowerCase()}.`,
                    ),
                },
              )
            }
          />
          <Button label="Volver" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <AppText variant="bodyStrong">{card.title}</AppText>
      {options.length > 0 ? (
        <Select
          label="Se vuelve a cobrar desde"
          required
          options={options.map(({ value, label }) => ({ value, label }))}
          value={billFrom}
          onChange={setBillFrom}
          help="Los meses anteriores de la suspensión no se cobran."
        />
      ) : (
        <Notice
          icon="info"
          title="Esta suspensión empieza más adelante; todavía no se puede reactivar."
        />
      )}
      {end.isError ? <Notice title={describeError(end.error).message} /> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.md },
  chips: { gap: spacing.sm },
  item: { paddingBottom: spacing.md },
});
