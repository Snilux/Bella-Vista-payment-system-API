import {
  type Closing,
  countClosingRequestSchema,
  formatDate,
  formatMoney,
} from '@bella-vista/shared';
import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeError, fieldErrors } from '../../api/error-messages.js';
import { useClosingStep, useCountClosing } from '../../api/useClosings.js';
import { useAccount } from '../../session/session-store.js';
import {
  AmountField,
  AppText,
  Button,
  ConfirmSheet,
  colors,
  DataRow,
  Notice,
  ScreenLayout,
  StatusTag,
  SummaryCard,
  spacing,
  TextField,
} from '../../ui/index.js';
import { cashboxTitle } from '../cashboxes/cashbox-view.js';
import {
  CLOSING_TAGS,
  closingActions,
  countDifference,
  differenceText,
  figureRows,
  monthName,
  signedMoney,
} from './closing-view.js';

// One closing (G-08, and J-05 once opened; 3.2 §10.2; D-08, D-14): the figures the API computes
// (v_closing), the cash counted and the difference. Who may act and how depends on the role and
// the status (closingActions): whoever prepared it counts (notes required with a difference),
// the president or the member reviews, only the president closes (it locks the month). A closed
// closing is read only.

export function ClosingDetail({ closing, header }: { closing: Closing; header: ReactNode }) {
  const account = useAccount();
  const actions = account ? closingActions(closing, account) : null;
  const review = useClosingStep(closing.id, 'review');
  const close = useClosingStep(closing.id, 'close');
  const [confirming, setConfirming] = useState(false);
  const tag = CLOSING_TAGS[closing.status];
  const month = closing.type === 'monthly' ? monthName(closing.dateFrom.slice(0, 7)) : null;
  const stepError = review.isError
    ? describeError(review.error).message
    : close.isError
      ? describeError(close.error).message
      : null;

  const footer = actions?.close ? (
    <>
      <Button label="Cerrar corte" onPress={() => setConfirming(true)} loading={close.isPending} />
      {month ? (
        <AppText variant="caption" color={colors.textSecondary}>
          {`Al cerrarlo ya no se aceptan movimientos con fecha de ${month} en esta caja.`}
        </AppText>
      ) : null}
    </>
  ) : actions?.review ? (
    <>
      <Button
        label="Marcar como revisado"
        onPress={() => review.mutate()}
        loading={review.isPending}
      />
      <AppText variant="caption" color={colors.textSecondary}>
        Después de revisarlo, el presidente lo cierra.
      </AppText>
    </>
  ) : null;

  return (
    <ScreenLayout {...(footer ? { footer } : {})}>
      {header}
      <View style={styles.status}>
        <StatusTag tone={tag.tone} label={tag.label} />
        <AppText variant="caption" color={colors.textSecondary}>
          {`${closing.folio} · del ${closing.dateFrom} al ${closing.dateTo}`}
        </AppText>
      </View>
      <FiguresCard closing={closing} />
      {closing.notes ? <Notice icon="info" title={closing.notes} /> : null}
      {actions?.count ? <CountForm closing={closing} /> : null}
      <SummaryCard tone="plain">
        <DataRow label="Preparó" value={closing.preparedBy.fullName} />
        {closing.reviewedBy && closing.reviewedAt ? (
          <DataRow
            label="Revisó"
            value={`${closing.reviewedBy.username} · ${formatDate(closing.reviewedAt.slice(0, 10))}`}
          />
        ) : null}
        {closing.closedBy && closing.closedAt ? (
          <DataRow
            label="Cerró"
            value={`${closing.closedBy.username} · ${formatDate(closing.closedAt.slice(0, 10))}`}
          />
        ) : null}
      </SummaryCard>
      {closing.status === 'closed' ? (
        <AppText variant="caption" color={colors.textSecondary}>
          {month
            ? `Corte cerrado: solo de consulta. ${month[0]?.toUpperCase()}${month.slice(1)} ya no acepta movimientos en esta caja; una diferencia se aclara en el mes abierto.`
            : 'Corte cerrado: solo de consulta.'}
        </AppText>
      ) : null}
      {stepError ? <Notice title={stepError} /> : null}
      <ConfirmSheet
        visible={confirming}
        title="¿Cerrar el corte?"
        confirmLabel="Sí, cerrar"
        loading={close.isPending}
        onConfirm={() => close.mutate(undefined, { onSettled: () => setConfirming(false) })}
        onCancel={() => setConfirming(false)}
      >
        <AppText variant="body">
          {`${cashboxTitle(closing.cashbox)} · ${differenceText(closing.difference)}. ${
            month
              ? `Después de cerrarlo no se podrá registrar ningún movimiento con fecha de ${month} en esta caja.`
              : 'Después de cerrarlo ya no se puede cambiar.'
          }`}
        </AppText>
      </ConfirmSheet>
    </ScreenLayout>
  );
}

/** Saldo inicial, each movement, "Debe haber", the cash counted and the difference. */
export function FiguresCard({
  closing,
}: {
  closing: Pick<Closing, 'figures' | 'countedCash' | 'difference'>;
}) {
  return (
    <SummaryCard tone="plain">
      {figureRows(closing.figures).map((row) => (
        <DataRow
          key={row.label}
          label={row.label}
          value={row.signed ? signedMoney(row.amount) : formatMoney(row.amount)}
          amount
        />
      ))}
      <DataRow label="Debe haber" value={formatMoney(closing.figures.expectedBalance)} amount />
      {closing.countedCash !== null ? (
        <>
          <DataRow label="Efectivo contado" value={formatMoney(closing.countedCash)} amount />
          <DataRow
            label="Diferencia"
            value={
              closing.difference === 0 || closing.difference === null
                ? 'Sin diferencia'
                : signedMoney(closing.difference)
            }
            amount
          />
        </>
      ) : null}
    </SummaryCard>
  );
}

/** J-05 / G-08 for whoever prepared it: the cash counted and the notes. */
function CountForm({ closing }: { closing: Closing }) {
  const count = useCountClosing(closing.id);
  const [counted, setCounted] = useState<number | null>(closing.countedCash);
  const [notes, setNotes] = useState(closing.notes ?? '');
  const [missing, setMissing] = useState<string | null>(null);
  const expected = closing.figures.expectedBalance;
  const difference = countDifference(expected, counted);
  const server = count.isError ? fieldErrors(count.error) : {};
  const general =
    count.isError && Object.keys(server).length === 0 ? describeError(count.error).message : null;
  const needsNotes = difference !== null && notes.trim() === '';

  const submit = () => {
    if (counted === null) {
      setMissing('Escriba el efectivo que contó.');
      return;
    }
    setMissing(null);
    const parsed = countClosingRequestSchema.safeParse({ countedCash: counted, notes });
    if (parsed.success) count.mutate(parsed.data);
  };

  return (
    <View style={styles.form}>
      <AmountField
        label="Efectivo contado"
        required
        valueCents={counted}
        onChangeCents={(cents) => {
          setCounted(cents);
          setMissing(null);
          if (count.isError) count.reset();
        }}
        help="Cuente el efectivo de la caja y escriba el total."
        error={missing ?? difference ?? server.countedCash ?? null}
      />
      <TextField
        label="Observaciones"
        required={difference !== null}
        value={notes}
        onChangeText={(text) => {
          setNotes(text);
          if (count.isError) count.reset();
        }}
        help={
          difference ? 'Explique la diferencia; el presidente la revisará.' : 'Opcional si cuadra.'
        }
        error={server.notes ?? null}
        maxLength={1000}
        multiline
      />
      {general ? <Notice title={general} /> : null}
      {count.isSuccess ? <Notice icon="success" title="Conteo guardado." /> : null}
      <Button
        label={closing.countedCash === null ? 'Guardar conteo' : 'Corregir conteo'}
        onPress={submit}
        loading={count.isPending}
        disabledReason={needsNotes ? 'Escriba una observación: el efectivo no cuadra.' : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  status: { gap: spacing.xs },
  form: { gap: spacing.md },
});
