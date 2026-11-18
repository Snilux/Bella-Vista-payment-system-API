// S-04 · Acuerdos
import type { Agreement } from '@bella-vista/shared';
import { formatDate } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { agreementPages } from '../../../../../src/api/useAgreements.js';
import {
  AGREEMENT_RESULT_LABELS,
  votesLine,
} from '../../../../../src/features/registry/agreement-view.js';
import { useCan } from '../../../../../src/session/permissions.js';
import {
  AppText,
  BottomSheet,
  Button,
  colors,
  DataRow,
  Header,
  PaginatedList,
  RecordCard,
  ScreenLayout,
  spacing,
} from '../../../../../src/ui/index.js';

// What was voted in each meeting (Figma S-04; 3.2 §10.7), newest first, paginated. An agreement
// is never edited: it is corrected with another one that mentions it. Minutes are a text
// reference, never a file (D-26).

export default function Agreements() {
  const canRegister = useCan('agreements.manage');
  const [open, setOpen] = useState<Agreement | null>(null);

  return (
    <ScreenLayout
      scroll={false}
      {...(canRegister
        ? {
            footer: (
              <Button
                label="Registrar acuerdo"
                onPress={() => router.push('/secretary/more/agreements/new')}
              />
            ),
          }
        : {})}
    >
      <PaginatedList
        queryKey={agreementPages.queryKey}
        fetchPage={agreementPages.fetchPage}
        keyExtractor={(agreement) => String(agreement.id)}
        renderItem={(agreement) => (
          <View style={styles.item}>
            <RecordCard
              title={`${agreement.folio} · ${AGREEMENT_RESULT_LABELS[agreement.result]}`}
              details={[`${formatDate(agreement.meetingDate)} · ${agreement.topic}`]}
              onPress={() => setOpen(agreement)}
            />
          </View>
        )}
        empty={{
          message: 'Todavía no hay acuerdos registrados.',
          icon: 'agreement',
          ...(canRegister
            ? {
                action: {
                  label: 'Registrar acuerdo',
                  onPress: () => router.push('/secretary/more/agreements/new'),
                },
              }
            : {}),
        }}
        header={
          <View style={styles.header}>
            <Header
              title="Acuerdos"
              subtitle="Lo que se votó en cada junta"
              onBack={() => router.back()}
            />
            <AppText variant="caption" color={colors.textSecondary}>
              Un acuerdo no se edita; se corrige con otro acuerdo que lo mencione.
            </AppText>
          </View>
        }
      />

      {open ? (
        <BottomSheet visible title={`Acuerdo ${open.folio}`} onClose={() => setOpen(null)}>
          <DataRow label="Junta" value={formatDate(open.meetingDate)} />
          <DataRow label="Tema" value={open.topic} />
          <DataRow label="Resultado" value={AGREEMENT_RESULT_LABELS[open.result]} />
          {votesLine(open) ? <DataRow label="Votos" value={votesLine(open) ?? ''} /> : null}
          {open.minutesReference ? <DataRow label="Acta" value={open.minutesReference} /> : null}
          {open.correctsId !== null ? (
            <AppText variant="caption" color={colors.textSecondary}>
              Corrige un acuerdo anterior.
            </AppText>
          ) : null}
        </BottomSheet>
      ) : null}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.md },
  item: { paddingBottom: spacing.md },
});
