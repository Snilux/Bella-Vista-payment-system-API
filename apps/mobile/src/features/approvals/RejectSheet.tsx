import { useEffect, useState } from 'react';
import { AppText, BottomSheet, Button, colors, Notice, TextField } from '../../ui/index.js';

// R-03 "Rechazar": the reason is mandatory (docs/api.md; 3.2 §12). While it is empty the button
// stays disabled and says why, so the president never sends a rejection without it.

export const REJECT_NEEDS_REASON = 'Escriba el motivo para poder rechazar.';

export type RejectSheetProps = {
  visible: boolean;
  /** What is being rejected (the request's description). */
  summary: string;
  loading: boolean;
  serverError: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

export function RejectSheet({
  visible,
  summary,
  loading,
  serverError,
  onConfirm,
  onCancel,
}: RejectSheetProps) {
  const [reason, setReason] = useState('');

  // Each opening starts empty.
  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  const trimmed = reason.trim();
  return (
    <BottomSheet
      visible={visible}
      title="Rechazar solicitud"
      onClose={loading ? () => undefined : onCancel}
      footer={
        <>
          <Button
            label="Rechazar"
            variant="danger"
            loading={loading}
            disabledReason={trimmed === '' ? REJECT_NEEDS_REASON : null}
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
        label="Motivo del rechazo"
        required
        value={reason}
        onChangeText={setReason}
        help="Quien la solicitó leerá este motivo."
        maxLength={500}
        multiline
      />
      {serverError ? <Notice title={serverError} /> : null}
      <AppText variant="caption" color={colors.textSecondary}>
        El rechazo queda en la bitácora con su motivo.
      </AppText>
    </BottomSheet>
  );
}
