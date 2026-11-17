import { accountReasonRequestSchema } from '@bella-vista/shared';
import { useEffect, useState } from 'react';
import { AppText, ConfirmSheet, colors, Notice, TextField } from '../../ui/index.js';
import { type AccountCommand, COMMAND_TEXTS } from './account-status.js';

// A-03: the confirmation of an account action, with its reason (3.2 §10.8). The reason is
// asked inside each confirmation, so the text written for one action never goes with another;
// it ends in the technical audit log ("Toda acción queda en la bitácora técnica").

export type ReasonSheetProps = {
  command: AccountCommand | null;
  username: string;
  loading: boolean;
  /** The API's answer when the action failed (already in Spanish). */
  serverError: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

export function ReasonSheet({
  command,
  username,
  loading,
  serverError,
  onConfirm,
  onCancel,
}: ReasonSheetProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Each opening starts empty.
  useEffect(() => {
    if (command) {
      setReason('');
      setError(null);
    }
  }, [command]);

  if (!command) return null;
  const text = COMMAND_TEXTS[command];

  const confirm = () => {
    const parsed = accountReasonRequestSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Escriba el motivo.');
      return;
    }
    setError(null);
    onConfirm(parsed.data.reason);
  };

  return (
    <ConfirmSheet
      visible
      title={text.title}
      confirmLabel={text.confirm}
      danger={text.danger}
      loading={loading}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <AppText variant="bodyStrong">{username}</AppText>
      <AppText variant="body">{text.effect}</AppText>
      <TextField
        label="Motivo"
        required
        value={reason}
        onChangeText={setReason}
        error={error}
        help="Toda acción queda en la bitácora técnica."
        maxLength={500}
        returnKeyType="done"
        onSubmitEditing={confirm}
      />
      {serverError ? <Notice title={serverError} /> : null}
      <AppText variant="caption" color={colors.textSecondary}>
        Revise el usuario antes de confirmar.
      </AppText>
    </ConfirmSheet>
  );
}
