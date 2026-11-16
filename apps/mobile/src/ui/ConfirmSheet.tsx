import type { ReactNode } from 'react';
import { BottomSheet } from './BottomSheet.js';
import { Button } from './Button.js';

// Hoja de confirmación (2.4 §6.7): summary, primary "Sí, confirmar" and secondary "Volver".
// Used before moving money (2.4 §1.5) and by handovers, expenses and requests.

export type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  /** The full summary of what is about to happen. */
  children: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  /** Danger look for cancelling or rejecting (2.4 §6.1). */
  danger?: boolean;
  /** While saving the button says "Guardando..." and ignores presses. */
  loading?: boolean;
};

export function ConfirmSheet({
  visible,
  title,
  children,
  onConfirm,
  onCancel,
  confirmLabel = 'Sí, confirmar',
  danger = false,
  loading = false,
}: ConfirmSheetProps) {
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
            onPress={onConfirm}
            loading={loading}
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
      {children}
    </BottomSheet>
  );
}
