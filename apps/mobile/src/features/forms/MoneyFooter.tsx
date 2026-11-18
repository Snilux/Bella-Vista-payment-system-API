import type { ReactNode } from 'react';
import { UNKNOWN_OUTCOME_MESSAGE } from '../../api/error-messages.js';
import type { MoneyOperationStatus } from '../../api/useMoneyOperation.js';
import { AppText, Button, colors } from '../../ui/index.js';

// The fixed footer of a screen that sends a money operation (3.2 §3.3): the confirm button
// ("Guardando..." while it goes) or, when no answer arrived, "Reintentar" with the same
// Idempotency-Key and the explanation. It only paints what useMoneyOperation says.

type Operation = {
  status: MoneyOperationStatus;
  sending: boolean;
  retry: () => Promise<void>;
};

export type MoneyFooterProps = {
  operation: Operation;
  label: string;
  onPress: () => void;
  loadingLabel?: string;
  disabledReason?: string | null;
  /** Under the main button (e.g. "Guardar como pendiente"). */
  secondary?: ReactNode;
};

export function MoneyFooter({
  operation,
  label,
  onPress,
  loadingLabel = 'Guardando...',
  disabledReason = null,
  secondary,
}: MoneyFooterProps) {
  if (operation.status === 'unknown') {
    return (
      <>
        <Button
          label="Reintentar"
          onPress={() => void operation.retry()}
          loading={operation.sending}
          loadingLabel={loadingLabel}
        />
        <AppText variant="caption" color={colors.textSecondary}>
          {UNKNOWN_OUTCOME_MESSAGE}
        </AppText>
      </>
    );
  }
  return (
    <>
      <Button
        label={label}
        onPress={onPress}
        loading={operation.sending}
        loadingLabel={loadingLabel}
        disabledReason={disabledReason}
      />
      {secondary}
    </>
  );
}
