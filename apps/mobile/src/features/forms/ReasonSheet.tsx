import { useEffect, useState } from 'react';
import { AppText, BottomSheet, Button, colors, Notice, TextField } from '../../ui/index.js';

// A confirmation that needs a reason (R-03 "Rechazar", J-06 "Cancelar solicitud", S-08
// "Suspender"…). While the reason is empty the button stays disabled and says why (2.4: a
// disabled button explains itself), so nothing is sent without it.

export type ReasonSheetProps = {
  visible: boolean;
  title: string;
  /** What is about to happen, in bold. */
  summary: string;
  /** The label of the field, e.g. "Motivo del rechazo". */
  reasonLabel: string;
  confirmLabel: string;
  /** Why the button is disabled while the reason is empty. */
  needsReason: string;
  help?: string;
  footnote?: string;
  danger?: boolean;
  loading: boolean;
  serverError: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

export function ReasonSheet({
  visible,
  title,
  summary,
  reasonLabel,
  confirmLabel,
  needsReason,
  help,
  footnote,
  danger = true,
  loading,
  serverError,
  onConfirm,
  onCancel,
}: ReasonSheetProps) {
  const [reason, setReason] = useState('');

  // Each opening starts empty.
  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  const trimmed = reason.trim();
  return (
    <BottomSheet
      visible={visible}
      title={title}
      onClose={loading ? () => undefined : onCancel}
      footer={
        <>
          <Button
            label={confirmLabel}
            variant={danger ? 'danger' : 'primary'}
            loading={loading}
            disabledReason={trimmed === '' ? needsReason : null}
            onPress={() => onConfirm(trimmed)}
          />
          <Button
            label="Volver"
            variant="secondary"
            onPress={onCancel}
            disabledReason={loading ? 'Espere a que termine de guardar.' : null}
          />
        </>
      }
    >
      <AppText variant="bodyStrong">{summary}</AppText>
      <TextField
        label={reasonLabel}
        required
        value={reason}
        onChangeText={setReason}
        {...(help ? { help } : {})}
        maxLength={500}
        multiline
      />
      {serverError ? <Notice title={serverError} /> : null}
      {footnote ? (
        <AppText variant="caption" color={colors.textSecondary}>
          {footnote}
        </AppText>
      ) : null}
    </BottomSheet>
  );
}
